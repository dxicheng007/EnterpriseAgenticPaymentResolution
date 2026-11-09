# Progress checkpoint — November 8, 2026

This checkpoint publishes completed local work, preserves separately committed candidates, and records remaining work. It is not acceptance of the complete demo. Machine checks, independent Astra review, and joint user acceptance remain distinct.

**Latest:** reviewed integration `8962292` clarifies other-account records, investigation records, and the amount still owed after proposed import. Typecheck and 254 unit tests pass after the lifecycle integration; 101 PostgreSQL integration tests and the V0 gate also pass. Separate bootstrap result schemas and the pure import planner are accepted. The full combined V2 gate also passes on `8962292`: 21 commands, 94 assertions and ten safe screenshots. The unmounted discovery lifecycle is accepted; source validation and independent bootstrap expectations remain in progress. Joint user acceptance is pending. See [the terminology checkpoint](#terminology-and-bootstrap-contract-checkpoint).

## Published checkpoint (historical)

The table and capability list below describe the first publication. Later accepted work is recorded under Continued build update and Latest integrated checkpoint.

### Branches and exact candidates

| Branch | State at checkpoint | Review status |
| --- | --- | --- |
| `main`, `codex/local-build` | Reviewed integration through `450a289f151c3fcf14cc0f2ac9a69035e61efa6f`, plus this documentation checkpoint | Integrated changes independently reviewed within their stated scope; user acceptance pending |
| `codex/source-evidence` | `3dd6173dacc7d8d80d796a32ea946029f3adc2c8`: assemble and pin paired captured v2 evidence | Implementer checks complete; fresh independent review pending; not integrated |
| `codex/evaluator-preview` | `b03fced6023a31bd8e0b74e8dec7180286794d57`: check evidence against observed planner lineage | Implementer checks complete; fresh independent review pending; not integrated |
| `codex/source-preview-ui` | `464bd0a504ea360b977548f6db6c98549895f5cd`: clarify unmapped preview records | Reviewed and already integrated |
| `codex/verification-startup` | `b172632e176c2da56e922f6aa8acdde3442b227d`: activation contract shapes | Reviewed and already integrated; schema work only |

Candidate branches are published for continuity, not promoted to accepted behavior. Their base is older than the latest integration; combine and verify them only after independent review.

## Working local capabilities

- Node 24 / strict TypeScript / npm workspaces, Fastify, React/Vite, PostgreSQL 18, Zod, Vitest, and Playwright.
- Separate control and runtime storage credentials, native setup, health checks, and durable activity.
- Two synthetic acquisitions with different source structures, contracts, amendments, exported context, and financial events.
- Complete immutable source captures; citations become usable after capture, with original bytes and locators preserved.
- Local reviewer session without a login screen, source dossiers, evidence inspection, and deterministic connector preview against an explicitly empty target fixture.
- Company A's selected fixture profile projects an $800 balance with zero parent writes. Company B's selected profile projects zero; its unidentified $300 remittance remains held.
- Protected independent evaluator with twelve implemented mandatory checks. Integrated v1 verification still reports evidence support unavailable and is ineligible; C1 provides validated v2 storage but is not the evidence assertion checker.
- Immutable verification pinning and historical-selection preservation, browser checks, fixture isolation, and scoped preview diagnostics.
- Strict activation and parent-read contract shapes with backward-compatible hashes. They do not enable activation or prove bootstrap execution.

## Verification evidence and limits

At integrated code commit `450a289`, root executed `npm run typecheck` and `npm run test:unit`: both passed, with **132 unit tests**. Earlier integrated PostgreSQL checks passed 59 tests; do not interpret that historical run as a full database run at this checkpoint. Independent reviews below record their exact candidates and focused checks.

The source-evidence implementer reports 121 unit tests, four focused integration tests, and a successful 64-test full integration retry. The first full run hit an existing reviewer-job polling deadline (63 passed, one timed out); no timeout was relaxed. The evidence-checker implementer reports exact-candidate typecheck, 48 focused evaluator unit tests, and a real A/B v2 integration check, plus 121 full unit and four focused integration tests on the unchanged precommit tree. Its isolated v2 reports show 13 passing checks, but this is **not yet independently reviewed or integrated demo behavior**.

- [Source-evidence candidate report](handoffs/b-evidence-assembly-report.md)
- [Evidence-checker candidate report](handoffs/c2-evidence-checker-report.md)
- [Independent reviews](reviews/): historical reports retain exact candidate identities, commands, findings, and limitations. Earlier reports are not claims about later commits.
- [Activation shapes review](reviews/v3-shapes-independent-review.md): contract-only PASS; review-checkout typecheck was limited by a missing workspace link. The integrated root typecheck subsequently passed.

No live LLM construction, customer activation, financial import, AI-free continuing sync, or complete end-to-end demo acceptance is claimed. API-key configuration is deferred by the user. No live-model calls are needed for the current deterministic work.

## Latest joint-review feedback

The user found Company A's “11 operations” followed by “19 unsupported rows” confusing. The first presentation repair passed its technical review but did not satisfy the user's guided-demo expectations. Joint acceptance remains pending.

The current adapter constructs one development profile from the first account's agreement while preview retains the complete company snapshot. For Company A, 19 held events represent 18 financial records for two other documented source accounts plus one amendment event. Company B's 19 consist of 18 other-account records plus one genuinely unresolved remittance. These are source-account findings, not verified parent identities. Proposed operations and held source events are different measures.

The approved product direction remains: explore sources → observe agents investigate evidence and construct profiles/rules → review customer coverage and exceptions → preview and independently verify → explicitly approve one customer → synchronize deterministically with AI disabled. The current fixture adapter is not live discovery. A richer source-account summary needs a typed, citation-bound interface; the frontend must not infer identity from `UNKNOWN_ACCOUNT` alone.

See the [guided discovery audit](handoffs/guided-discovery-audit.md) for exact fixture counts, available evidence, proposed categories, testable acceptance, and ownership. This is guidance, not an implemented screen or a new financial rule.

## Next dependency steps

1. Fresh independent Astra reviews of the source-evidence and evidence-checker candidates; send any fixes to their Sol implementers.
2. Integrate accepted candidates; run combined checks, an explicit fresh-root v2 setup preserving historical pins, and a real v2 browser checkpoint. The existing browser verification helper intentionally exercises legacy v1 fixtures.
3. Complete the V2 slice verification runner and joint evidence/preview review. Do not infer user acceptance from passing tests.
4. Freeze and implement separate bootstrap verification and activation consumers. Contract shapes alone are insufficient; readiness stays false until the required proof exists.
5. Build the already specified observable discovery workflow and guided review. Live construction needs the later user-configured provider key. Preserve deterministic/scripted orchestration tests as separate evidence from model competence.
6. Implement persisted parent import, bounded automatic sync, cutover/retry/recovery, and drift handling, then rehearse the complete two-company demo.

See the [implementation plan](../../superpowers/plans/2026-11-08-implementation-plan.md) for vertical tasks and dependency trees. Astra leads and independent reviewers direct bounded Sol implementation; commits describe coherent changes with labeled subjects under 20 words.

## Handoff records and repository boundaries

- [Evidence v2 contract](handoffs/evidence-v2-contract.md), [ownership handoffs](handoffs/evidence-v2-handoffs.md), and [stages](handoffs/evidence-v2-stages.md).
- [Accepted activation contract proposal](handoffs/v3-contract-proposal.md); executable shapes and authoritative clarification are in the [versioned freeze addendum](../../superpowers/plans/2026-11-08-contract-freeze-v2-activation-shapes.md).

Some archived reports reference local scratch paths. They are historical provenance, not setup dependencies. Product setup and authoritative instructions use the tracked repository guides. This checkpoint includes source code, generators, plans, selected handoffs, and review reports. It excludes local database contents, credentials, generated source bundles, protected verification truth, dependency installs, and raw authenticated browser traces. Regenerate local fixtures using the tracked setup scripts.

## Continued build update

After the publication checkpoint, fresh independent Astra reviews accepted the evidence checker and evidence assembly. They were integrated at `f3e5375808da004bc27092c3c159dac5dcad821c`. Combined typecheck, 132 unit tests, and 64 isolated PostgreSQL integration tests passed. See [checker review](reviews/c2-evidence-independent-review.md) and [assembly review](reviews/b-assembly-independent-review.md).

An explicit new-root v2 upgrade of the running demo succeeded. Fingerprints confirmed 116 previous source/evidence/pin files were unchanged and the prior selection was backed up. After a supervisor restart, actual browser jobs for both companies showed all 13 mandatory checks passed, complete coverage, and eligibility for review. Company A projected $800 and Company B $0; both previews displayed zero parent writes. This was a manual composed smoke, not the executable full V2 gate, bootstrap verification, live discovery, activation, or joint acceptance. Earlier reports remain historical records.

The source coverage wire contract `9a627f6` was independently reviewed and integrated at `33364f0`. Its [review](reviews/source-coverage-contract-independent-review.md) records 31 focused tests, typecheck, and 90 independent malformed-input/scope/normalization assertions. The [guided-discovery implementation handoff](handoffs/guided-discovery-implementation.md) defines the separate evidence-backed source read and UI consumers. At this update those consumers are not accepted or integrated; the contract does not itself establish source authenticity.

The reproducible [actual-v2 browser checkpoint](handoffs/c3-v2-browser.md) is being implemented. The [V2 verification runner](handoffs/b-v2-verifier.md) follows its independent acceptance. These handoffs describe planned tests and required evidence; their presence is not a claim that those tasks passed. V4 orchestration architecture is separately under review and has no implemented lifecycle or provider yet.

## Latest integrated checkpoint

Reviewed integration `fbd6f0fe3ce6bf3fda9a128c7d6aebf4d1549970` adds the evidence-backed source-account read and reproducible actual-v2 browser verification. Root ran typecheck and 166 unit tests successfully on the combined code, followed by the actual-v2 Chromium test on an isolated PostgreSQL lease (one passed, 20.2 seconds). The all-thirteen financial-check browser result is repeatable; this is still not the complete V2 gate or user acceptance.

- [Source coverage read review](reviews/source-coverage-read-independent-review.md): accepted candidate `c5d51b6`; captured agreements, directories and related evidence establish source observations without approving a parent identity. The real route preserves all 30/28 source events and performs no writes.
- [Actual-v2 browser review](reviews/c3-v2-browser-independent-review.md): accepted candidate `98bc50c` (code `1ac3248`); real paired source preparation, protected verifier jobs, thirteen passing checks per company, two safe screenshots and unchanged runtime records.

The guided preview UI, full V2 command, and bounded discovery contract types are being implemented in separate worktrees. Their pending work is not part of the accepted integration above. The source read is implemented but the running main control process will be restarted after the UI is accepted, so the live demo and repository may temporarily differ.

The discovery design has passed its architecture fix review for contract and activity-read primitives. No discovery lifecycle, provider adapter, agent monitor, activation or ongoing synchronization is implemented by that architecture approval. API-key configuration remains deferred. The next stages remain guided review, executable V2 evidence, separate bootstrap verification and activation, observable discovery, and deterministic continuing sync.

## Guided review and discovery contracts

At combined integration `15dd830cf638626d18af92c11859d57d11ff777c`, typecheck and all 198 unit tests pass. The [guided preview](reviews/c-guided-preview-independent-review.md) (`d30d48d`) and [discovery contracts](reviews/b-v4-contracts-independent-review.md) (`40c8c6d`) each passed fresh independent Astra review. The local supervisor was restarted with the guided preview and source coverage read, preserving the existing database and selected v2 pins. Actual browser smoke confirmed A: 30 events, 11 selected, 19 outside (all documented), $800 and zero writes; B: 28 events, 9 selected, 19 outside (18 documented and one unresolved), $0 and zero writes. Joint clarity feedback is requested and remains pending.

The source cards link actual citations and retain each original hold. They explain which accounts have no profile in the selected candidate. Live agent construction is explicitly pending; the cards are evidence-derived observations, not simulated agent output. See the [builder report](handoffs/c-guided-preview-ui-report.md).

The [accepted discovery architecture](handoffs/v4-orchestration-contract-proposal.md), [architecture fix review](reviews/v4-orchestration-contract-fix-review.md), [contract handoff](handoffs/b-v4-contracts.md) and [builder report](handoffs/b-v4-contracts-report.md) accompany the executable [v3 discovery-shapes freeze](../../superpowers/plans/2026-11-08-contract-freeze-v3-discovery-shapes.md). The next [activity read primitive](handoffs/b-v4-activity-read.md) is assigned separately; schema acceptance does not establish durable orchestration, SSE or a functioning monitor. Separate bootstrap verification architecture is being specified before activation consumers may claim readiness.

## Full V2 checkpoint and current feedback

The executable [V2 gate](handoffs/b-v2-verifier-report.md) passed fresh [independent review](reviews/b-v2-verifier-independent-review.md) and was integrated. The [discovery activity reader](handoffs/b-v4-activity-read-report.md) also passed [independent PostgreSQL review](reviews/b-v4-activity-independent-review.md).

The first combined V2 run on `a356b11` failed because the actual-v2 browser test still expected the old empty-target label. The gate retained failed evidence and withheld screenshots. [Investigation](handoffs/v2-combined-failure-investigation.md) reproduced the failure before preview/evaluator execution. The original UI implementer repaired the label, projected-balance locator and artifact disclosure assertions in `b1b5605`; [fresh scoped review](reviews/c3-guided-compatibility-fix-review.md) found all assertions preserved. No financial or gate checks were weakened.

The full combined command then passed on exact clean `e34a0f629a1fee90e738c317b2e243044f83a7a1`: **21 commands, 94 named assertions, ten validated PNGs, zero gate diagnostics**. Packet identity: `.evidence/e34a0f629a1fee90e738c317b2e243044f83a7a1/V2/2026-11-09T00-21-58-120Z-71889/`. Root independently checked its exact 15-file inventory, mode 0600 files and screenshot hashes; the safe packet was copied to user-facing outputs. This is a synthetic development/empty-target V2 machine pass, not bootstrap execution, live-agent construction, persisted parent import or automatic sync.

The user still found “unsupported rows” and “projected balance” unclear. Root explained that A's 19 outside-profile events belong to two other documented accounts, while B additionally has a genuinely unresolved payment. A's $800 is remaining receivable at cutover after allocated payments/credits, not money moved or an invoice created; before $0 is the empty demo parent. The [terminology handoff](handoffs/preview-terminology-handoff.md) specifies conservative presentation groups and a server-backed “Amount still owed after proposed import” label. Implementation and joint clarity acceptance are pending at this checkpoint.

The separate bootstrap [proposal](handoffs/v3-bootstrap-verification-proposal.md), [handoffs](handoffs/v3-bootstrap-handoffs.md), [initial review](reviews/v3-bootstrap-architecture-independent-review.md) and [fix review](reviews/v3-bootstrap-architecture-fix-review.md) freeze prerequisite direction, not activation readiness. The [S0 contract brief](handoffs/b-bootstrap-contracts.md) is assigned; its implementation requires its own review. Current exact-subject financial evidence remains insufficient for bootstrap until the separate checker/registry and financial bridge exist.

The durable discovery [lifecycle handoff](handoffs/v4-lifecycle-handoffs.md) passed [architecture fix review](reviews/v4-lifecycle-fix-review.md). L1 repository/supervisor implementation is assigned; production remains unconfigured, and scripted clients are test-only. The [read-only source validator](handoffs/b-discovery-capture-read.md) is a separate L2 prerequisite. Root reserved control 004 for discovery and control 005 for the later bootstrap registry; no out-of-order migration insertion is permitted. Source validator, HTTP composition, real tools, monitor and provider execution retain their own gates.


## Terminology and bootstrap contract checkpoint

The user-facing terminology candidate `855f1b0` passed [independent review](reviews/preview-terminology-independent-review.md) and was integrated at `8962292`. The [builder report](handoffs/preview-terminology-report.md) records the exact display and browser checks. The live demo now distinguishes **Other accounts needing connectors** from **Records needing investigation**, while preserving the underlying held records and diagnostics. A has 19 other-account events; B has 18 other-account events and one unresolved payment. The conservative grouping never treats mixed, ambiguous or selected-customer failures as safely unrelated.

**Amount still owed after proposed import** is the server-calculated unpaid invoice amount at the preview cutoff, after allocated payments and credits. A's $800 represents $9,000 invoiced less $8,000 allocated payments and $200 allocated credits. Unallocated funds do not lower it. **Empty demo target before import** explains the parent fixture's initial $0 without implying that the acquired customer owed nothing. Preview still performs zero parent writes. Root inspected both live company previews after integration; this is a display smoke, not joint acceptance.

Bootstrap contract candidate `a49a8cf` passed [independent review](reviews/b-bootstrap-contracts-independent-review.md) and was integrated at `210bc98`. Its [builder report](handoffs/b-bootstrap-contracts-report.md) and [freeze](../../superpowers/plans/2026-11-08-contract-freeze-v3-bootstrap-verification.md) define separate strict result schemas, coverage and hashing. Parsing a result establishes its shape, not that the checks ran or that activation is authorized. Existing financial report and bundle hashes remain unchanged.

On combined `8962292`, root typecheck and all 238 unit tests passed. The pure bootstrap planner is under fresh review, durable discovery lifecycle and read-only capture validation are being implemented separately. Production live discovery, activation, persisted parent import and automatic sync are still pending.

The fresh full V2 gate on clean `89622924c1c6ae1b34f56fd0908b8c8f30c0a328` passed **21 commands and 94 named assertions**, retaining ten hash-verified PNGs and no diagnostics. Packet: `.evidence/89622924c1c6ae1b34f56fd0908b8c8f30c0a328/V2/2026-11-09T00-36-07-517Z-79044/`. Its safe 15-file inventory was copied to user-facing outputs. This verifies the combined preview and evaluator paths; bootstrap execution and durable discovery still require their own later checks.


## Pure bootstrap planner checkpoint

Candidate `c4f862a` passed [fresh Astra review](reviews/b-bootstrap-planner-independent-review.md) and was integrated at `83f64f3`. The [planner report](handoffs/b-bootstrap-planner-report.md) records 39 focused tests and behavioral red checks. Root ran typecheck and all **253 unit tests** on the combined integration. The unchanged financial planner now has a separate pure wrapper that prepares customer, account and billing-configuration records, preserves exact reused metadata, adds evidence lineage and rejects blocked or empty import baselines. It projects into a copied target and performs no writes.

The full V2 packet remains specifically for `8962292`; the new planner has its focused and combined unit evidence, not a new full bootstrap gate. Its [independent oracle](handoffs/b-bootstrap-oracle.md) is assigned next. Complete bootstrap verification, review readiness and activation still await their dependent runner, registry and authority components.


## Durable discovery lifecycle checkpoint

L1 candidate `e754790` passed [independent Astra review](reviews/v4-lifecycle-L1-independent-review.md) and was integrated at `42bcfa6`. The [builder report](handoffs/v4-lifecycle-L1-report.md) records the exact concurrency barriers and limitations. Root ran typecheck, **254 unit tests**, **101 PostgreSQL integration tests**, and the full **V0 gate** on that combined integration. V0 packet: `.evidence/42bcfa613e75119de88ae514639fc01ce6ecf2ae/V0/2026-11-09T00-45-29-503Z-88698/`. These checks used an isolated cluster, not the live demo.

The [discovery package guide](../../../packages/discovery/AGENTS.md) explains the dedicated supervisor connection, durable budgets, pause/replay, timeout accounting and generation fencing. The component is deliberately unmounted; L2 still must provide HTTP authorization, validated pinned captures, mandatory capture recheck, and atomic delegation. Review found no blocking defect. Cross-task native-ID reuse and byte-oversized persistence cases are recorded as narrow additional coverage for L2, not claimed as existing L1 tests.

Control migration 004 is now implemented. The later bootstrap registry remains assigned 005. Live-model execution, agent-generated connector construction, parent persistence and automatic sync remain unavailable.
