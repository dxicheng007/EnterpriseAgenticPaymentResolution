# Bounded owner-delta review: PR35 / PR36 / PR37

Reviewer: delegated agent `/root/new_owner_deltas_review`, separate from the candidate builders. Read-only inspection of immutable Git objects in `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`. No source edits, merge, comments, DB/browser/provider execution, or assessment of working-tree WIP. This report does not grant slice acceptance or authorize scheduler/application implementation.

## Identity and judgments

| Candidate | Exact base | Exact head reviewed | Specification judgment | Quality judgment |
|---|---|---|---|---|
| OPEN PR35 | `83c5c0a9191108e42edfaeaa02f1464a1bc71392` | `1218ece20431b1ebd0d532fb4fe9fd489ad603c8` | Changes requested: V7/full-live false pass | Fixture browser smoke is useful; gate conflates prerequisite success with full slice success |
| OPEN PR36, new commit only | `1068e20e4a95bf18d678a93b8e1d606a15f60755` | `53b791401d7307de2a976841dff57dcecf17aa52` | Changes requested at dependency-helper boundary; no re-review of preceding classification implementation | Small pure module, but input/closure bounds need hardening and tests use structurally incomplete casts |
| MERGED PR37 | `83c5c0a9191108e42edfaeaa02f1464a1bc71392` | `6918f6bd8e671d5a538f972a4235d53125cfbbfa` | No blocking defect for explicitly partial capture/authority harness scope; not V6 acceptance | Integration tests exercise real implementation; browser is only health/stub smoke |

The supplied PR37 source tip `2b4cf12be0ecbed835429b71bf6845ecae79263f` is not present in the local object database (`git cat-file -t` failed). This review covers the exact merged four-file diff, not a separately verified equivalence to that source tip.

Applicable guidance: root/apps/scripts/tests AGENTS; PRD product thesis, process boundaries, §§11–13 and acceptance criteria; implementation plan execution conventions and T5.1/T6.1/T6.2/T7.1; frozen F1/F3/F6/F8; verification playbook verification statuses, evidence packet and G6/G7. Classification companion consumer rules were read solely to interpret the new helper's input contract. Contract-freeze v1 SHA-256 at all three reviewed heads: `863cdbc91c527b5e6d1f08e0ee7dedfd4483a0548249954ea732e196394d077a`.

## Prioritized findings

### PR35 — P1: New V7 gate reports passed without mandatory live evidence

Locations: `scripts/verify-slice-evidence.ts:206–211`, `scripts/verify-slice.ts:721–734,849–872`, `tests/live/v7-holdout.test.ts:12–24` at the reviewed head.

`v7ExitCode` returns zero after exactly three successful commands and a Chromium version. Those commands are fixture Sources/Preview browser wiring, a test that deletes the provider key and asserts a configuration error, and typecheck. `verifyV7` deliberately removes provider configuration and invokes `test:live -- --evidence`; it then writes `slice: V7, result: passed` and logs `V7 verification passed`. There is no real construction, final unseen holdout, approved ongoing sync, complete earlier-slice gate, or three recorded live rehearsals. Pending G7 and limitation strings do not repair a false machine-pass status. T7.1 expressly says missing live evidence fails the live gate; G7 requires G0–G6 machine checks and three complete live rehearsals.

The new `tests/live/v7-holdout.test.ts` also completes successfully when run through this head's ordinary live runner with any nonempty configured key: the runner admits the key, then the test removes it and exercises only local configuration helpers. Thus the new purported holdout target can produce a successful live-command exit without using the supplied configuration or evaluating a holdout. This describes the new V7 target, not a re-review of the inherited V4 defect.

Smallest correction: preserve fixture/configuration observations as an explicitly named partial prerequisite result, but keep full V7 and the unavailable live-holdout command nonzero with a precise unavailable diagnostic. Do not repair this by fabricating a live adapter or expanding into scheduler/apply. Add isolated runner/packet regressions proving missing live evidence never becomes a full slice pass, including present-key and evidence-mode paths. Update the new scripts guide text to match that distinction.

### PR36 — P2: A missing provider is synthesized into a successful dependency order

Location: `apps/worker/src/sync/dependencies.ts:50–76`.

The graph is built only from supplied mapped items, but recursion treats an absent referenced index as a node with no prerequisites (`edges.get(index) ?? []`) and pushes that index into the result. Passing one item at input index 0 whose candidate provider is index 99 returns `[99, 0]`, although no item 99 exists. This can occur if a caller supplies an incomplete selected closure; the API accepts an item array and does not state or enforce a complete-closure precondition. PRD §11 requires inconsistent prerequisite data to remain explicit exceptions. A nominally successful ordering containing a nonexistent record cannot fulfill that contract. No current monetary application call site was found, so this is a new helper-boundary defect, not a claim of observed parent corruption.

Smallest correction: before traversal, reject candidate references that do not resolve to exactly one supplied mapped representative; reject duplicate input indexes rather than letting Map assignment silently overwrite them. Preserve cycle exceptions and add complete, typed negative fixtures. Verify provider identity/scope consistency or explicitly constrain this helper to the unmodified complete classification returned by the trusted classifier; never interpret candidate presence alone as financial validity.

### PR36 — P2: Caller override bypasses the advertised 1,000-event ceiling

Location: `apps/worker/src/sync/dependencies.ts:25–35`.

`selectGroups` uses its supplied `limit` without validating it against `MAX_INBOX_EVENTS`. A single group of 1,001 records is accepted by `selectGroups(groups, 1001)`; `NaN` also disables both comparisons. The classification companion requires the entire proposed invocation, including prerequisite/replay occurrences, to retain the existing 1,000-input ceiling. A configurable lower budget is reasonable, but an unchecked upper override makes this helper unable to enforce its own exported bound. Current compiler revalidation is a separate backstop; no financial bypass through a mounted worker path is asserted.

Smallest correction: require a safe integral limit within the allowed range, capped at the immutable maximum, and test 1,000/1,001 and invalid budgets. Continue to reject oversized whole groups without splitting them. No persistence or cycle runner changes are needed.

## Separate proof limits and nonblocking observations

### PR36

- `missingPrerequisites` returns opaque target-record IDs, discarding prerequisite relation, economic identity and scope. These IDs are hashes of economic identity, so this is **not** evidence of an invoice/payment ID collision. A later durable lookup must retain/recover the full typed key and selected scope from the original classification. The helper output alone cannot authorize cross-scope lookup or application.
- `dependencyOrder` includes materialized held entries and candidate providers without checking final group acceptance. That is acceptable as graph ordering only; it is not an executable plan or evidence that a provider is financially valid.
- The unit fixture uses `as unknown as InputClassification` and omits scope, identity, event and plan/group metadata. Four tests establish simple graph order/cycle detection, group sorting and scalar thresholds, not compatibility with real compiler output, typed scope preservation, closure selection or durable examinations. Add at least one real classification-to-helper regression before presenting that integration as proved.
- The threshold/backoff helpers are pure numeric policies. They do not prove persisted distinct examinations, prevent recounting a replay, create holds/quarantine, or schedule retry. The classification design explicitly leaves retry-count/cycle policy to the later runtime gate; the owner should cite the applicable policy decision before treating these constants as an accepted persistence contract.
- The Vitest include expansion correctly makes app unit tests discoverable. It is a root configuration change requiring the normal integrator ownership check, not itself a test bypass.

### PR37

The four integration cases compose actual review preparation/intent, worker activation, capture and current-authority services over disposable PostgreSQL. They verify committed activation replay, durable capture replay across a new pool, authority pause/revoke replay and stale/resume rejection, and semantic mismatch on resume. The financial fingerprint includes nonempty activated financial/import state in integration; preserving that state is a meaningful regression guard. The diff does not remap V6 into a passing full-slice runner, and comments explicitly leave application/G6 pending.

Coverage remains narrower than V6:

- Schema drift is injected for an unknown account and accepted as raw capture, as the capture contract permits. The test never invokes a financial classifier/apply path or asserts automatic A pause. B's authority is read as active; B does not process a fresh record. This proves capture isolation, not drift containment during synchronization.
- The modified replay's deliberately incorrect hash tests envelope validation, not a validly rehashed changed-delivery or CSV batch conflict.
- Recovery reopens capture through a new pool; it does not kill/restart the worker process, inject an application crash/rollback, lose an ongoing-sync response, run two competing appliers, or exercise revoke/application lock order. Sequential epoch assertions are not a PostgreSQL race proof.
- Browser lines 47–53 call `createTestSystem().sourceAdmin.inject`, whose implementation in `tests/fixtures/harness.ts:106–109` unconditionally throws `FEATURE_NOT_IMPLEMENTED`. The browser mounts the V0 health harness, injects no actual financial/drift event, and compares untouched financial tables. Its request counter observes browser requests only, not worker network activity. This is health/readiness plus known-stub smoke; it cannot prove product mutation refusal, runtime AI isolation or containment. Smallest cleanup is to label/rehome this as that limited smoke and avoid counting it toward containment; real future UI containment evidence belongs to the separately authorized implementation.

No requirement to implement missing scheduler/apply functionality is imposed by this partial review. Full V5/V6/V7 and joint G5/G6/G7 remain unproved/pending.

## Reviewer verification

- Read exact commit diffs and referenced real implementations/fixtures with `git show`; inspected applicable specs and guides.
- `git diff --check` passed for each exact base/head pair.
- Ran only one isolated, no-DB pure probe using a byte-for-byte extraction of PR36's dependency module under `/private/tmp/eapr-owner-delta-probe`, Node 24 with type transformation. Output: `{"danglingProvider":[99,0],"aboveHardBound":1001}`. Probe source remains there for reproduction. This is adversarial helper evidence, not a full unit-suite result.
- Did not run typecheck, DB integration, Playwright, provider calls or slice gates. Builder/merge-message test claims were not independently rerun and are not adopted as reviewer machine evidence.

Final bounded recommendation: return PR35 for fail-closed machine-status correction; return PR36 for small helper-boundary hardening and real typed fixture coverage; retain PR37 only as explicitly partial integration/health scaffolding. Combined integration verification and joint user acceptance are separate subsequent steps.
