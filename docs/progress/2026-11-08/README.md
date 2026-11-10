# Progress checkpoint — November 8, 2026

This checkpoint publishes completed local work, preserves separately committed candidates, and records remaining work. It is not acceptance of the complete demo. Machine checks, independent Astra review, and joint user acceptance remain distinct.

**Latest:** authenticated parent reads are integrated at `ff0238c`. Combined typecheck, unit and focused PostgreSQL checks, and full V0/V2 gates passed. The running demo uses actual worker parent reads for both published customer scopes; both remain inactive, preview writes zero parent records, and all 253 original source/pin hashes are unchanged. Approval preparation is being implemented. Discovery proposals and their result-limit correction are integrated at `d91a1af`, after independent review and combined typecheck, 351 unit tests and 115 PostgreSQL checks. Customer activation, live model construction and ongoing sync remain incomplete. See the [three-team handoff](../../superpowers/plans/2026-11-08-team-expansion-handoff.md) for current ownership and dependency gates. The active demo track (pregenerated connector + AI-off sync) and high-level remaining tasks for later delegation are in [demo remaining work](../../superpowers/plans/2026-11-10-demo-remaining-work.md).

| PRD slice | Current status | Remaining acceptance |
| --- | --- | --- |
| V0 — Foundation | Implemented; machine gate passing | Final whole-workflow review |
| V1 — Sources and evidence | Implemented; machine gate passing | Joint evidence review |
| V2 — Preview and financial verification | Implemented; latest integrated gate passing | Joint preview acceptance |
| V3 — Customer approval and activation | Parent reads and proof/storage prerequisites integrated; approval preparation active | Actual worker import, receipt recovery and reviewer flow |
| V4 — Agent construction | Lifecycle, monitor, read tools, findings and proposals integrated | Document applicability, compilation, provider and live checks |
| V5 — Ongoing deterministic sync | Not operational | Bounded sync and cutover workflow |
| V6 — Failure and recovery proof | Component protections tested | End-to-end sync/recovery verification |
| V7 — Full demo | Incomplete | Two-company rehearsal and joint acceptance |

Three of eight machine gates have passed; this is not a percentage estimate of completed effort.

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


## Validated source capture checkpoint

Source candidate `413d6e9` passed [fresh Astra review](reviews/b-discovery-capture-read-independent-review.md) and was integrated at `1dae289`. See its [builder report](handoffs/b-discovery-capture-read-report.md). Root typecheck and 254 unit tests passed, followed by all 12 discovery-capture PostgreSQL tests with lifecycle tables installed and the full V1 source/evidence gate. V1 packet: `.evidence/1dae28994cbcbc97f784489fc89a99eea0aa7f01/V1/2026-11-09T00-48-55-688Z-90703/`. No source or runtime writes occur in the validator.

The selected capture is checked against original bytes, registered resource schemas, manifest/snapshot membership, citation content and relational associations, with exact rechecks after external reads. Valid sellerless events remain part of the captured evidence and are omitted only from the exact seller/account tuple list. This preserves unresolved input for investigation instead of inventing an identity or silently dropping evidence.

The live supervisor was restarted on `a905c32`, before this additive reader integration: health reports control migration 4 and runtime migration 1. All 253 existing demo/source/verification files retained identical fingerprints. A fresh browser preview still displays Company A's $800 unpaid amount, other-account category and zero parent writes. The read-only discovery entry point is not mounted until the separately specified L2 integration.


## Joint terminology acceptance

The user confirmed: “got it this is good, let's use this terminology,” explicitly choosing **Other accounts needing connectors** and **Records needing investigation**. This records acceptance of those presentation categories and their explanation. It does not imply approval of a customer, acceptance of financial reconstruction, or completion of the V2/V4 joint gates. The balance label remains **Amount still owed after proposed import**.


## Independent bootstrap expectations and financial bridge

S2 `e212cbd` passed [independent review](reviews/b-bootstrap-oracle-independent-review.md); S4b `1e2bf32` passed [independent review](reviews/b-bootstrap-financial-bridge-independent-review.md). Both are integrated at `2a2f292`. Root typecheck, **260 unit tests**, and all **seven affected PostgreSQL integration tests** passed on that combined code. [Oracle report](handoffs/b-bootstrap-oracle-report.md) and [financial bridge report](handoffs/b-bootstrap-financial-bridge-report.md) retain exact candidate evidence and limits.

The protected oracle derives expected metadata, financial effects and lineage from source facts across the ten defined cases. The financial checker now permits a shape-valid bootstrap-bearing profile while retaining all previous financial evidence checks on the exact new subject. Actual A/B reports still require all thirteen checks. This does not certify metadata ensures, create approval authority, or activate a connection. The standalone bootstrap runner and trusted result registry remain pending.

The [L2 discovery handoff](handoffs/b-discovery-l2.md) passed [scoped architecture fix review](reviews/b-discovery-l2-fix-review.md), correcting source error passthrough and requiring all delegation dependencies/memberships to be checked before the first batch effect. Implementation is assigned separately; accepted architecture is not an implemented API.

Reproducibility note: S2's report digests belong to its exact candidate. The combined `2a2f292` run produced different sidecar digests with the same capture hashes because discovery workspace entries changed `package-lock.json`. The generator includes that lockfile in its build identity, which flows through protected producer/evidence hashes into the sidecar. This is an expected build-bound difference, not changed captured financial content.


## Agreement-backed development profiles

S4a candidate `7308e6c` passed [fresh Astra review](reviews/b-bootstrap-candidate-metadata-independent-review.md) and was integrated at `cbeb7f9`. The [builder report](handoffs/b-bootstrap-candidate-metadata-report.md) preserves the initial 113/116 integration run, the test-fixture correction and two timing failures. The corrected exact head passed all 116 integration tests with original time limits. Root combined typecheck and 260 unit tests passed.

Version 2 profiles preserve the designated agreement's parsed legal name and citation and use stable configuration IDs. Historical version 1 profiles remain separately registered; unchanged spec bytes retain their version. Actual new subjects receive fresh financial reports; metadata does not grant approval or bootstrap readiness.

The complete V2 gate passed on exact clean `cbeb7f9b1ff18048691a3c6a270186a521ab2b2a`: **21 commands, 94 assertions, ten PNGs, no diagnostics**. Packet `.evidence/cbeb7f9b1ff18048691a3c6a270186a521ab2b2a/V2/2026-11-09T01-57-34-433Z-7239/` has fifteen mode-0600 files and independently checked screenshot hashes. Safe copies are in user-facing outputs. This remains a development-fixture, zero-parent-write preview gate.

The [bootstrap runner handoff](handoffs/b-bootstrap-runner.md) passed [architecture review](reviews/b-bootstrap-runner-independent-review.md) and implementation is assigned. Root subsequently authorized a narrow internal `transport.ts` extraction and matching financial launcher build-manifest entry, keeping the generic transport private while preserving existing financial protocol semantics. The implementation still requires its own review and real subprocess checks.


## Authenticated discovery lifecycle integration

L2 `ef06e02` passed [fresh Astra code review](reviews/b-discovery-l2-independent-code-review.md) and was integrated at `d867b43`. Its [report](handoffs/b-discovery-l2-report.md) records exact boundaries and the isolated clone used for implementation. Root typecheck, all 260 unit tests, and all 47 affected PostgreSQL tests passed on the combined integration with agreement-backed profile metadata.

The localhost session now protects capability/start/state/pause/resume routes. With no ModelClient configured, startup creates no supervisor or scheduling loop and new discovery remains unavailable. Injected test clients exercise real durable scheduling and atomic delegation; they are not live-agent evidence. Pinned source validation, mandatory transactional recheck, whole-batch dependency/member preflight and per-effect current authority remain separate checks. Findings/proposals, source read tools, provider execution and the monitor are still pending.


## Protected bootstrap runner checkpoint

S3a `da5b2ac2523dfd3c6ef06aa7b223c39badd79276` passed [fresh Astra code review](reviews/b-bootstrap-runner-independent-code-review.md) and is integrated at `735e680088f3fb4ad43ed1a72439a1f293351879`. The [builder report](handoffs/b-bootstrap-runner-report.md) records 71 evaluator unit tests and five focused PostgreSQL tests. The runner retains the actual baseline plan returned by the subprocess and checks nine assertions across ten executed cases for both registered A/B captures. Protected configuration is available only to the evaluator through bounded fd 3; subject and public completion contain no expected facts or protected roots. Shared transport stays private.

Root combined typecheck, unit suite, bootstrap-runner/setup PostgreSQL tests, and the complete V2 gate passed on clean `735e680`. Packet `.evidence/735e680088f3fb4ad43ed1a72439a1f293351879/V2/2026-11-09T02-18-06-389Z-16559/` contains 21 successful commands, 94 assertions, ten hash-checked screenshots, fifteen mode-0600 files and no diagnostics. The localhost supervisor was restarted on this code while preserving all 253 existing source/pin files. These checks do not prove durable bootstrap reservation/completion, readiness, activation or continuing sync.

## Reviewed next implementation boundaries

The [evidence-tool handoff](handoffs/b-discovery-evidence-tools.md) and [monitor handoff](handoffs/b-discovery-monitor-handoff.md) passed [scoped fix review](reviews/b-discovery-next-fix-review.md). Evidence responses expose bounded selected text and citation identity; owner interruption is distinct from sticky authorization/capture blockers. Monitor reconnect uses a bounded fetch stream with the last delivered cursor and current session authorization. Both remain implementation work.

The [activation proposal](handoffs/v3-activation-authority-proposal.md) and [task handoffs](handoffs/v3-activation-authority-handoffs.md) passed [scoped fix review](reviews/v3-activation-authority-fix-review.md). Source-authoritative semantic observation is an explicit prerequisite, and early parent storage is separate from composed registry-backed reads. Root reserves control006 for financial provenance, control007 for review/activation intents, and runtime002 for parent activation storage, after existing/reserved predecessors. These reservations are coordination only; no migration or financial authority is created by this checkpoint.


## Durable bootstrap proof checkpoint

S3b `dbf2f09451e6094a0f801867751cac2ff3db16ea` passed [independent Astra review](reviews/b-bootstrap-registry-independent-review.md) and is integrated at `c664e2cf731e802191b35f4ae371a98a96a04b4e`. [Report](handoffs/b-bootstrap-registry-report.md) and [assignment](handoffs/b-bootstrap-registry.md) record its exact scope. The registry assigns job IDs and persists exact requests before execution. Completion atomically stores the returned proof and actual observed plan; restart reads revalidate the full association. Negative comparison results remain unavailable to the successful-proof reader. Control005 follows control004 without changing applied migrations.

Root combined typecheck, 279 unit tests, four affected PostgreSQL tests and full V0 passed on clean `c664e2c`. V0 packet: `.evidence/c664e2cf731e802191b35f4ae371a98a96a04b4e/V0/2026-11-09T02-28-15-385Z-22583/`. Previous V2 packet remains tied to `735e680`; it is not relabeled as a later run. Authenticated readiness composition, financial attestation, first import and ongoing sync remain separate work.

The [additive authority freeze](../../superpowers/plans/2026-11-08-contract-freeze-v4-activation-authority.md) and [A0 assignment](handoffs/b-activation-authority-contracts.md) define the next contract-only implementation. Monitor server and client/UI have separate assigned owners; real browser proof depends on the actual server stream.


## Authenticated activity stream

M1 `a32721ce9d50472d69b8644cab42940912176f7d` passed [independent review](reviews/b-discovery-events-independent-review.md) and is integrated at `85f76868105737b3d718ee7fe5c46f5e75a7b975`. The [builder report](handoffs/b-discovery-events-report.md) records focused transport tests. Root combined typecheck and all 28 PostgreSQL tests across events, activity reads and lifecycle HTTP passed. The stream uses the same current reviewer/run authorization, exact per-event cursors, bounded backpressure and cleanup. It is control-run activity only; it does not claim the later combined control/runtime event API. The client/UI and real browser monitor proof are being implemented separately.


## Additive authority contracts

A0 `437739c96f2e27a417650c188967e26f20fc97cc` passed [independent review](reviews/b-activation-authority-contracts-independent-review.md) and is integrated at `633651778cfd4f5176831c8286f01132fd142a9f`. See [implementation evidence](handoffs/b-activation-authority-contracts-implementation-report.md). Root combined typecheck, 293 unit tests and four protected-run PostgreSQL tests passed. Strict safe attestations, complete policy tuples, scoped state/index and additive v2 bundle/hash contracts preserve existing v1 golden values. The bootstrap manifest now pins the three added runtime contract modules. These contracts neither install a trust policy nor grant financial authority.


## Discovery monitor and read contract checkpoint

M2 `3f6a9fceb4cfc4b5987f0b1ac78c2571e37cfe1a` passed [independent review](reviews/b-discovery-monitor-independent-review.md) and is integrated at `700d1353b9d18d6425b79e710636d68690424b79`. Its [report](handoffs/b-discovery-monitor-implementation-report.md) distinguishes the scripted real-service browser fixture from default unconfigured operation. Root combined typecheck, 309 unit tests and both Chromium cases passed, followed by the complete V2 gate. Packet `.evidence/700d1353b9d18d6425b79e710636d68690424b79/V2/2026-11-09T02-39-46-819Z-29702/` has 21 successful commands, 94 assertions, ten hash-checked PNGs, fifteen mode-0600 files and no diagnostics. Safe copies are in user-facing outputs.

The live supervisor restarted on `700d135`, preserving all 253 existing source/pin files. Direct browser inspection confirms Discovery navigation, saved-run input and honest model/start-unavailable state. Active-run behavior is established by the real durable scripted test, not a seeded product run or a live LLM. Idle stream headers may wait for activity/heartbeat; controls use authoritative loaded state and actual POST authorization while connection status remains explicit. This is not full V4 or joint acceptance.

D0 `0f0fca3a9d0a429aa792b0da5ce854e6f8d17542` passed [independent review](reviews/b-discovery-read-contracts-independent-review.md) and is integrated at `c60fe26d6aa9068a93376ae6b69de572e80918f9`. Root typecheck, 138 focused contract/build tests and the real bootstrap registry integration passed. The [report](handoffs/b-discovery-read-contracts-report.md) records exact argument/result bounds and runtime UTF-16 search semantics. Source authorization and lifecycle tool claims remain D1/D2 work; descriptors alone enable no tool.

## Current parallel implementation lanes

1. [D1 source evidence tools](handoffs/b-discovery-evidence-implementation-handoffs.md): exact captured membership, coverage, bounded excerpts and reproducible citations; D2 orchestration follows accepted source interfaces.
2. [A1a financial attestation](handoffs/b-financial-attestation-handoffs.md): fixed protected process evaluates the exact reserved evidence bytes, preserving all thirteen financial checks. [Handoff review](reviews/b-financial-attestation-handoff-independent-review.md) accepts staged execution. A valid ineligible report remains auditable; execution/decoding/binding failure cannot become a successful completion.
3. [A3a parent persistence](handoffs/b-parent-storage-handoff.md): runtime002 and transaction-bound immutable records/receipts/snapshots. [Handoff review](reviews/b-parent-storage-handoff-independent-review.md) accepts this storage-only scope. Composed inactive reads still depend on A2; no grant route or sync loop is included.

All three lanes require exact-candidate independent review before integration. Their current assignments are not evidence of implemented financial authority.


## Pinned source read tools

D1 initial `7242138` was withheld after review found that a source-wide CSV query could lack a captured original batch row. Corrected `d4f14bff7ba1bfb269cb166efd9c2828b691e4a2` passed [fresh scoped review](reviews/b-discovery-source-tools-fix-review.md) and is integrated at `5b4c257d71610a3fa8645b2b9040d4e11f848e9f`. The [report](handoffs/b-discovery-source-tools-report.md) preserves both the reproduced failure and fix evidence. Query requires complete original-row proof before applying account-only citation filtering. Prepared content uses the detached original-verified extraction instead of reloading mutable rows after validation.

Root combined typecheck, 32 focused unit tests, 21 source/capture PostgreSQL tests and the full V1 gate passed. Packet `.evidence/5b4c257d71610a3fa8645b2b9040d4e11f848e9f/V1/2026-11-09T02-56-54-844Z-39486/` records the source/evidence regression. D2 owns actual tool advertisement, claims, guarded settlement, pause/recovery and persistence; a library alone does not enable live discovery.


## Parent persistence and exact-byte financial execution

A3a `bb8c070930c14364af1a98695ad904fec5b3c238` passed [independent review](reviews/b-parent-storage-independent-review.md). The [report](handoffs/b-parent-storage-report.md) records storage-only scope, actual app-role races/rollback, canonical Unicode handling and immutable history. Runtime002 provides transaction-bound persistence, not a mounted grant route. Receipt target IDs preserve financial operation order; metadata remains in the exact plan, lineage and snapshot. Lock tokens bind the PoolClient, so later A5 must acquire locks inside every transaction attempt; the storage API does not independently attest transaction identity.

A1a initial `4a79b53` was withheld for failure-code classification and missing temporal build-mutation evidence. Corrected `4ff530765374cc3e016a1024e44718a4105e3af2` passed [fresh scoped review](reviews/b-financial-attestation-runner-fix-review.md). Its [report](handoffs/b-financial-attestation-runner-report.md) preserves the red/green history. The protected child evaluates the exact initially decoded evidence bytes, preserves fixed request-bound mismatch diagnostics, and rejects a build change during evaluation. Valid negative comparisons remain ineligible audit results; malformed or unavailable execution cannot become a completed attestation. All thirteen financial checks remain required and legacy transport behavior is retained.

Both are integrated at clean `5ce860b4a74d8db13c96c27a2af8bd5164527625`. Root typecheck, 332 unit tests, 32 real PostgreSQL tests, full V0 and full V2 passed. V0 packet: `.evidence/5ce860b4a74d8db13c96c27a2af8bd5164527625/V0/2026-11-09T03-06-51-509Z-45095/`. V2 packet: `.evidence/5ce860b4a74d8db13c96c27a2af8bd5164527625/V2/2026-11-09T03-06-57-510Z-45734/`, with 21 successful commands, 94 assertions, ten verified PNGs, fifteen mode-0600 files and no diagnostics. Historical source/selection files retained all 253 original hashes. These results do not grant customer authority, install a policy or prove a complete V3/V4 demo.


## Durable financial verification provenance

A1b `766714f80d31c6d2bbb961ff3094bc4a9a0d7615` passed [independent Astra review](reviews/b-financial-attestation-registry-independent-review.md) and is integrated at `98a13af32366a66a19512c0873fdb480ea8de4a1`. The [implementation report](handoffs/b-financial-attestation-registry-report.md) records reservation-before-launch, atomic report/attestation completion, exact replay and conflict handling, restart validation and single-entry policy binding. Root combined typecheck and 333 unit tests passed. Independent review reran the real A/B protected PostgreSQL registry test. A1c authenticated composition and policy installation remain separate; the current demo does not yet grant activation authority.


## Guarded discovery evidence execution

D2 corrected candidate `a5209db46bc82b28f95bbe31b7ff550b958677a2` passed [fresh scoped Astra review](reviews/b-discovery-evidence-lifecycle-fix-review.md) after the initial recovery finding. The [report](handoffs/b-discovery-evidence-lifecycle-report.md) records four regressions reproduced before the fix and 87 focused PostgreSQL checks after it. The real source reader now executes under durable claims and guarded settlement; observed authority revocation remains a sticky blocker through owner replacement and pause/resume. Integrated `cde1958c76abb40a3e6f34007e3edb46e42e1cb1` passed combined typecheck and 34 PostgreSQL checks across lifecycle HTTP, evidence execution and financial registry. No live model or constructed connector is claimed.

Root moved the unimplemented review/activation-intent reservation to control008 and assigned control007 to discovery findings/proposals, so independently developed discovery persistence can land first without inserting an earlier migration later. No applied SQL was changed.


## Authoritative source observation prerequisite

AS corrected candidate `b3af86b00057e3236d478c6cb038c992be4e9236` passed [independent Astra review](reviews/b-source-semantics-independent-review.md) and is integrated at `85e2c11dda2b1b61087299e4952b21ca8d27bebb`. The [report](handoffs/b-source-semantics-report.md) records real publication/append races and authenticated HTTP, including the shared router correction for valid 101–160-character source IDs and sanitized malformed-path errors. Builder typecheck, 337 unit checks and 24 PostgreSQL checks passed; reviewer independently reran four targeted PostgreSQL/HTTP cases. Default mounting, selected-profile comparisons and activation consumers remain separate.


## Authenticated financial attestation composition

A1c `ce63cfc942065d9625191881ffa7cba56df739b3` passed [independent Astra review](reviews/b-financial-attestation-composition-independent-review.md), with [implementation evidence](handoffs/b-financial-attestation-composition-report.md). Integrated `dbda6725eb21328871089b28c3da0e7d6af8b0a0` passed root typecheck, 339 units, five focused PostgreSQL checks, full V0 and full V2. V0 packet: `.evidence/dbda6725eb21328871089b28c3da0e7d6af8b0a0/V0/2026-11-09T06-35-59-816Z-77785/`. V2 packet: `.evidence/dbda6725eb21328871089b28c3da0e7d6af8b0a0/V2/2026-11-09T06-36-06-063Z-78303/`: 21 commands, 94 assertions, ten hash-verified PNGs, fifteen mode-0600 files, no diagnostics, authenticated traces disabled.

The local demo restarted on this code with ready control006/runtime002 and all 253 original source/pin file hashes unchanged. Root manually ran Company A preview and verification through the browser: $800, zero parent writes, completed job `52d41f39-65ff-4a35-8214-0508988b4088`, all thirteen mandatory checks passed. This is smoke evidence, not customer approval or joint acceptance. Historical reports remain readable; only new attested runs provide this provenance. Later source closure changes require fresh financial proof before current policy installation.


## Operator policy and discovery findings prerequisites

A2 `bc272a5127af0e288cc46ae7617f00de5ffee244` passed [independent review](reviews/b-activation-policy-independent-review.md), with [implementation evidence](handoffs/b-activation-policy-report.md), and is integrated at `fcbc0cf969bd965c115d07eb76ed250ea1f70d17`. Root combined typecheck, 346 unit tests and five PostgreSQL checks passed, including actual policy setup/publication and authenticated financial verification against the changed build closure. No production policy was installed. Scope publication remains independent of customer authority; final financial proof must match final installed build policy.

C1 corrected `aff21214ded3a59c1295bb1dc130079410106440` passed [fresh scoped review](reviews/b-discovery-findings-fix-review.md) and is integrated at `ae982dc230adffaa2ccf6d02b93c9151133e3407`. The [report](handoffs/b-discovery-findings-report.md) preserves four reproduced capacity failures and the 80-test focused regression. Findings remain pending agent interpretations; immutable revisions and sticky origins preserve unresolved evidence. Whole-batch projection now prevents earlier findings or children from committing before a later over-capacity delegation fails. Proposal tools and live model execution remain later checkpoints.

Root combined `ae982dc` typecheck, seven focused construction/discovery/build tests and 29 PostgreSQL tests passed across findings and authenticated verification. These checks include control007 alongside existing control006 provenance.


## Registered parent reads and recovery

A3b corrected candidate `a24adcf75dfcd5d92236c0bede2845c1463515c3` passed [fresh scoped Astra review](reviews/b-parent-reads-fix-review.md), following the [initial review](reviews/b-parent-reads-independent-review.md). The [implementation report](handoffs/b-parent-reads-report.md) records actual worker/control HTTP reads, explicit scope publication, inactive version-zero views, real preview composition and recovery after failed candidate registration. It is integrated at `ff0238c194b529c24e4be0c9c0ef6fdf36421be3`. The integration conflict was documentation only.

Root ran typecheck, unit tests, focused parent-read/composition/findings PostgreSQL checks, full V0 and full V2 successfully on the isolated 55433 lease. V0 packet: `.evidence/ff0238c194b529c24e4be0c9c0ef6fdf36421be3/V0/2026-11-09T07-09-22-180Z-98732/`. V2 packet: `.evidence/ff0238c194b529c24e4be0c9c0ef6fdf36421be3/V2/2026-11-09T07-09-28-337Z-99178/`, with 21 passing commands, ten hash-verified screenshots and no diagnostics. The V2 packet retains its slice limitations; persisted-parent behavior additionally has the dedicated parent-read checks and live smoke below.

After a preserving restart, root selected the two exact candidates from the authenticated current catalog, resolved their registered captures and explicitly published only their scope metadata. No activation policy or customer authority was installed. Authenticated live reads returned version zero and null activation for both customers; preview returned 80000/0 cents and zero parent writes. Canonical before/after contents of all runtime tables were identical. All 253 historical source/pin file hashes remained unchanged. This was API smoke evidence, not a new manual browser review or joint acceptance.

Accepted design handoffs now cover [approval preparation](handoffs/b-activation-review-handoff.md), its [receipt observation mirror](handoffs/b-activation-review-mirror-addendum.md), [worker activation](handoffs/b-worker-activation-handoff.md), and [discovery proposals](handoffs/b-discovery-proposals-handoff.md). These handoffs are not implementation claims. Control008 is reserved for approval/intents and the immutable receipt observation mirror. Actual worker receipts remain authoritative.


## Discovery proposal checkpoint and team handoff

C2 corrected `ced4a6a275f561fc56cb6cd2e55ae20d81442f0b` passed [scoped Astra review](reviews/b-discovery-proposals-fix-review.md) after the [original finding](reviews/b-discovery-proposals-independent-review.md). Its [report](handoffs/b-discovery-proposals-report.md) records fresh and recovered batch regressions reproduced before the fix. Root combined `d91a1af393584159d327dcdeaa7212acc7bf3d2d` passed typecheck, 351 unit tests and 115 PostgreSQL tests across proposals, findings, evidence tools, lifecycle, HTTP lifecycle and activity. This is not a live-model or full V4 gate claim.

A4 `78f355e49925b30cffa6b380b0a28f153d40376b` is preserved remotely on `codex/activation-review`, not merged into main. The [WIP report](handoffs/b-activation-review-report.md) records typecheck, 82 PostgreSQL checks, actual isolated setup/pending-intent/restart smoke, remaining adversarial coverage and pending independent review. A pending intent is not an import or worker receipt. The source document applicability [handoff](handoffs/b-document-applicability-handoff.md) passed [design correction review](reviews/b-document-applicability-handoff-fix-review.md); implementation has not started.

The [three-team expansion handoff](../../superpowers/plans/2026-11-08-team-expansion-handoff.md) passed [independent document review](reviews/team-expansion-handoff-review.md). It assigns the existing team financial authority/runtime integration, the first new developer source/discovery construction, and the second new developer reviewer/operations presentation and demo verification. The source association producer and read-only parent inspection can start independently; dependent approval/sync paths remain explicitly gated. Implementation agents are checkpointed, not running new work. The local supervisor remains running on `d91a1af` with ready control007/runtime002 and inactive customer scopes.


## Existing team A4/A5 integration checkpoint

The local branch `codex/platform-activation-integration` includes current main `c8ed642` (Discovery PRs3–7 and Experience PR8), completed approval preparation/intents and worker first import/receipt recovery. Corrected A5 code candidate `ffb597d032f44fa4af9e9285555136fab9ac2609` passed fresh scoped Astra review after the mirror-failure pending202 correction; A4 previously passed its authorization correction review. Root combined typecheck, 421 unit tests, 76 focused integration tests across thirteen files and one inactive-parent browser test passed. See the [current integration handoff](handoffs/platform-resumption-status.md), [A5 report](handoffs/platform-a5-implementation-report.md), [A5 correction review](reviews/platform-a5-mirror-fix-review.md) and [branch review](reviews/platform-integration-independent-review.md).

This is a local committed implementation checkpoint, not publication to main or full V3/joint acceptance. Experience's session-renewal P2 and approval browser flow remain open. The Discovery verification adapter has an accepted design only; producer implementation, live construction and ongoing sync remain later work. Preserved demo policy, authority and source pins are unchanged.

## Discovery verification producer and integration continuation

PR9 is merged into main at `bdf4da5`. The separate Platform continuation implements the retry-safe attested Discovery verification producer (Gate P) at `4af12bd`, with [fresh independent acceptance](reviews/platform-discovery-verification-producer-review.md) and [producer evidence](handoffs/platform-discovery-verification-producer-report.md). Control009 binds one persisted tool step to one immutable subject/job, with atomic budget reservation and confirmed-claim execution. Unknown commit outcomes never authorize launch. Gate J actual supervisor integration is still required before tools are mounted.

Root merged current main and Experience PR10 at `ad69245`; typecheck,427units,46focused integration tests and2actual browser tests passed. The [continuation handoff](handoffs/platform-continuation-dispatch.md) records exact scopes, migration hash and developer status. Experience PR11 has five [review findings](reviews/platform-experience-e1-review.md). A safe exact-package [review-details backend design](handoffs/platform-review-details-design.md) is independently accepted and planned next; the [sync capture design](handoffs/platform-sync-design.md) passed its bounded correction review, while later application/status and source batch-gap work remain gated. None of these design records is implementation or full slice acceptance.

## Immutable reviewer decision context

The Platform continuation adds the exact-package [review-details backend](handoffs/platform-review-details-report.md), independently accepted at `ef4077e` by [Astra review](reviews/platform-review-details-independent-review.md). It exposes saved balance/plan, evidence references, selected profile and bounded future rules under current grants, with zero writes and protected-data exclusion. Typecheck,444units and8focused backend tests passed; root additionally passed4 cross-boundary activation/protected-verification tests after the contract/build-closure change. Experience still owns presentation and the existing E1 recovery/stale/session findings; no approval-browser or fullV3 acceptance is implied.

The [actual-supervisor verification consumer handoff](handoffs/platform-discovery-verification-consumer-handoff.md) is independently design-reviewed and ready for separately reserved Discovery implementation. GateJ remains unimplemented; GateP does not advertise verification tools. [Current continuation status](handoffs/platform-continuation-dispatch.md) keeps implementation, design and acceptance evidence separate.

## Bounded runtime capture and latest developer review

Main now includes PR9, PR12 and PR13, plus the interim trusted verification-scope freeze, at `aafe7ae`. The Platform continuation implements internal API/semantic capture at `efce3de`: exact committed A5 initialization, global delivery/position identity, atomic page/inbox/cursor/activity, safe incidents and capture-only progress. The [builder report](handoffs/platform-sync-capture-report.md), [exact review](reviews/platform-sync-capture-independent-review.md) and [final integration review](reviews/platform-sync-capture-final-review.md) record acceptance. Typecheck, 25 focused units, 49 focused integration cases, all 464 units and five additional composition/migration checks passed. Runtime003 is additive; existing SQL is unchanged. Capture is unmounted and rejects CSV-bearing lanes; source polling, financial application and V5/V6 remain unfinished.

Discovery's new [PR15 review](reviews/platform-discovery-gate-j-7012a4d-review.md) requests owner-fencing, recovery, scoped-read and batch-preflight corrections; Gate J is not accepted. Experience's [PR14 review](reviews/platform-experience-details-be39242-review.md) recognizes exact financial summaries and session fixes, but inspectable evidence/readable stop conditions and two recovery paths remain incomplete. The [current-authority design](handoffs/platform-current-authority-design.md) is reviewed preparation only. The [continuation handoff](handoffs/platform-continuation-dispatch.md) records exact candidates, remaining gates and the separately observed unreviewed live-model transport branch.
