# Guided discovery audit

Read-only audit, 2026-11-08. Requested baseline `09104d4`; checkout advanced to `450a289f151c3fcf14cc0f2ac9a69035e61efa6f` during the audit through activation-contract integration. Parent confirmed preview/source fixtures were unchanged. No product files changed, services started, tests run, or acceptance status advanced. Counts below are a reproducible reading of public fixture/source construction, not a new live-run result or proof of approved parent identity.

## What Company A's 19 actually represent

The demo captures the whole company but constructs a candidate for its first account only. `scripts/load-demo.ts:115` designates `contract-1.pdf`; `apps/control/src/demo-candidates.ts:95` parses its captured page-one evidence and `:137` submits exactly one profile. Its mappings are explicitly authored development mappings, not live AI output.

`packages/sources/src/canonical-fixtures.ts:73` constructs this exact baseline:

| Source scope | Financial source records | Semantic events | Current one-profile preview |
| --- | ---: | ---: | --- |
| Account ending `-1`, Shared Buyer | 11 | 0 | 11 proposed financial operations |
| Account ending `-2`, Northstar Studio | 9 | 1 | 10 `UNKNOWN_ACCOUNT` holds |
| Account ending `-3`, Northstar Studio | 9 | 0 | 9 `UNKNOWN_ACCOUNT` holds |
| Total | 29 | 1 | 30 captured events; 19 held outside the supplied profile |

Each account has three months of invoices, payments, and payment allocations. Account 1 additionally has a credit and credit allocation in the last month. Account 2 has the executed amendment and its `sem-a-2` change event. Account 3 is a different buyer entity with the same display name as account 2 (`canonical-fixtures.ts:31`). Names must not merge them.

Thus the 19 are **18 financial records belonging to two other source accounts, plus one semantic amendment event**. They are not 19 customers, 19 missing payments, or evidence that the selected account's mapping failed. There is no deliberately unidentified remittance among Company A's 19. The original contracts and account-directory email supply visible evidence of the other source account/buyer identifiers; the amendment supplies additional terms (`scripts/generate-fixtures.ts:195–232`). This establishes an evidence-backed source-account distinction. It does **not** establish approved parent identities, verified candidate profiles, customer activation, or eligibility for those accounts.

The current preview response alone cannot prove this distinction. `apps/control/src/routes/preview.ts:136` partitions by exact seller/source account among the submitted profiles. Every event without a matching submitted profile gets the same unscoped `UNKNOWN_ACCOUNT` hold, even when other captured evidence identifies its source account. The response contains event IDs and diagnostics, not a cited account inventory. `apps/web/src/features/preview/preview-values.ts:55` therefore correctly avoids guessing identity, but its `unmapped` group still combines different reasons for noncoverage.

Company B demonstrates why relabeling all such rows as “other known customers” would be wrong. Its aggregate has 28 financial events: 9 for selected account 1, 18 for accounts 2 and 3, and one $300 remittance under `cust-b-unknown-…` with no allocation (`canonical-fixtures.ts:118–150`). Its one-profile preview also has 19 holds, but **18 belong to other documented source accounts and one is genuinely unresolved**. That payment must remain held; no AI guess or unallocated cash should lower any invoice balance.

## Why whole-company coverage and operation counts differ

Frozen F3 requires a complete aggregate snapshot; F4 binds its complete stream/file membership, evidence, hashes, and watermarks. `preview.ts:46–109` verifies that aggregate before partitioning it. Preserving all 30 A events exposes what this candidate covers and what remains outside it, while the account grant and profile bound the projected writes. Filtering the stored snapshot down to the selected profile would conceal coverage and change the pinned subject. UI presentation can separate the groups while preserving the underlying aggregate, holds, and zero writes.

“Operations” counts proposed target mutations. “Source events” counts captured inputs. “Holds” counts diagnostic groups, which may contain multiple event IDs in general. `unsupportedRows` is an alias of `outcome.holds` (`preview.ts:180`), not another batch of rejected records. The current UI deduplicates those representations. Do not add those counts together.

For this exact A fixture, the 11 selected records produce 3 invoice inserts, 3 payment inserts, 1 credit insert, and 4 allocations. There are no extra customer/account/configuration operations in this planner result (`packages/compiler/src/plan-batch.ts:93–111`). Semantic events do not create a monetary mutation (`:53`), and replay or held dependencies can also break a one-input/one-operation relationship. Here the count happens to be one-to-one. Three months' invoices total $9,000; allocations total $8,200; projected outstanding is $800. The last month's $3,000 − $2,000 allocated payment − $200 allocated credit explains that remaining balance. These are proposed imports of existing source records, not invoice issuance or money movement.

## What AI is meant to do

Yes: the approved product direction is for design-time agents to investigate source identities, agreements/amendments, and financial relationships, then build the connector and separately versioned customer profiles from evidence. The user should not have to manually author the mappings for every account. AI can propose how the documented accounts connect to parent identities; it must preserve the same-name entity distinction and abstain when evidence is insufficient.

That is V4, not what the current fixture adapter does. PRD §§4–5, 8, 14, 17 and implementation T4.1/T4.2 require observable specialist work, evidence retrieval, genuine generated specifications/profiles, independent verification, and correct holds. The existing adapter parses one designated agreement and binds fixed development mappings. A fixture result cannot satisfy live construction. Successful discovery and verification still do not activate a customer: PRD §10 and V3 require explicit per-customer approval of initial state and bounded future rules. Runtime then executes deterministically with no model calls. Connecting all 19 rows to the selected customer's account would violate that design.

## Concise guided flow within the existing PRD

This is presentation guidance for the owner, not an implemented feature or a new authority decision.

1. **Orient to source coverage.** Show the company, complete captured baseline, source-account inventory supported by citations, and the selected profile. Explain “This preview covers one customer from the company snapshot.” Keep development-fixture/empty-target status visible.
2. **Explain the selected customer's result.** Lead with the $800 projected balance, the $3,000/$2,000/$200 last-month explanation, and 11 proposed operations. Let the reviewer open the original invoice, allocation, and contract evidence and inspect mappings. Parent writes remain zero.
3. **Explain what is outside this preview.** For the audited A dataset, show two documented source accounts with 18 financial records and one amendment event, explicitly without a reviewed profile in this candidate. Link their identity evidence; for account 2 also link the amendment. Their next step is separate profile construction/review and verification, not joining them into the selected account. For B, separate the one unresolved remittance and explain what evidence is missing. Retain selected-customer blockers and source-wide identity/semantic blockers as distinct, actionable issues.
4. **Show readiness and the next real action.** Current flow: inspect evidence → preview fixture → independent verification when available. Show incomplete checks/ineligibility plainly. Future V4 flow: start discovery → inspect evidence-backed findings and unresolved questions → inspect generated profiles/rules → verify. Future V3/V5 flow: review bounded future authority → explicitly enable one customer → inspect worker receipt and parent reconstruction → demonstrate later supported records with AI disabled. Unimplemented stages must be labeled pending, not represented as completed or functioning buttons.

Useful category semantics: (a) selected-profile issues with exact approved scope, (b) documented source accounts lacking a profile in this candidate, (c) unresolved identity/relationship requiring evidence, and (d) source-wide blockers. Category (b) needs cited source evidence in addition to event linkage; `UNKNOWN_ACCOUNT`, an ID suffix, or a matching display name alone cannot establish it. Keep the original machine diagnostic available without making it the main reviewer explanation.

## Testable acceptance for a later assigned UI change

- A's visible source-event reconciliation is 30 = 11 selected + 19 outside the profile; the latter is 18 financial + 1 semantic, grouped as 10 and 9 events for distinct source accounts. No claim of two approved/verified parent customers.
- B's 19 holds distinguish 18 documented-other-account events from one unresolved remittance only when backed by allowed source evidence. The unresolved payment stays unscoped/held and does not change the selected balance.
- With only a bare unscoped `UNKNOWN_ACCOUNT` response, UI uses neutral “not mapped by these profiles” language and does not invent identity classifications. Same-name accounts remain distinct.
- Selected-customer and source-wide blockers remain visible; no issue is dropped, downgraded, or counted twice. Record counts use distinct event membership where appropriate, independently of operation and hold counts.
- Original evidence is reachable from the explanation; proposed profile status, verification status, and activation status stay distinct. Fixture and empty-target labels persist; preview writes remain zero.
- A reviewer can answer without logs: which customer is covered, why $800, what the other 19 are, what remains unresolved, and what action is actually available next. Machine checks, exact-candidate independent review, and joint user acceptance remain separate.

## Gaps and ownership

No new product decision is needed to explain the current counts or guide the already specified discovery → verification → per-customer approval flow. Exact UI copy/layout is routine implementation discretion within that scope.

An evidence-backed source-account summary is not currently present in the preview/demo/dossier contracts; the frontend cannot safely derive these richer categories from its present holds alone. A owns source/discovery evidence, B owns shared contract changes, and C owns UI/client consumption. They must agree the minimal typed, citation-bound read representation before implementation; this is an interface gap, not permission to use protected evaluator truth or weaken holds.

Do not promise that adding the other two profiles will automatically clear the 19. Amendment interpretation, historical semantic revisions, exact identity mapping, compilation, and independent checks still need their own construction/verification evidence. An account-2 candidate spans `sem-a-1` historical events and `sem-a-2` amended events, while the current simple adapter rejects mixed revisions; resolution belongs to the authoritative contract/source owners, not a UI relabeling. This audit makes no new semantic rule.

Automatically selecting or activating every account, guessing the unidentified remittance's owner/allocation, or representing fixture parsing as live AI construction has no authorization in the approved flow. If requested as new behavior, it would require explicit scope/behavior clarification; none is required for the bounded explanatory improvements above.
