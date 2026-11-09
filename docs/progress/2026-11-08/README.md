# Progress checkpoint — November 8, 2026

This checkpoint publishes completed local work, preserves separately committed candidates, and records remaining work. It is not acceptance of the complete demo. Machine checks, independent Astra review, and joint user acceptance remain distinct.

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
