### Spec Compliance

- ✅ Spec compliant for exact task candidate `578624a43a85c3e9b2dfe20803330b4506f7e786..cc78b73a075b90b5d53a086519542edcdeabaaa4`; the review package contains only the two authorized additions. The fixed signature, subject order and application-pool-only boundary match the brief (`tests/fixtures/sync-selection.ts:226`).
- ✅ Literal originals, independent 300000-cent expectations, exact PDF support, actual byte/canonical hashes, truthful source inventory and no-replace private writes match the accepted design (`tests/fixtures/sync-selection.ts:90`, `:158`, `:168`, `:193`, `:209`). No canonical fixture generation, output-derived expected economics, producer edit, selector or P1 writer appears in the change.
- ✅ One shared real capture feeds two independently compiled one-profile candidates, genuine financial completions, separate reviewer bootstrap/approval actions and committed-intent A5 deliveries. Exact targets/origins and the second account's absence before its approval are enforced before return (`tests/fixtures/sync-selection.ts:274`, `:281`, `:314`, `:414`, `:448`, `:490`).
- ✅ All four specified qualification cases are implemented, including exact financial/bootstrap coverage and bindings, full literal targets, distinct commitments, one shared lane, replay with unchanged non-capture state, independent input inventories, a second genuine construction and awaited lifecycle fault cleanup (`tests/integration/sync-selection.test.ts:96`, `:129`, `:256`, `:291`, `:311`, `:351`, `:370`).
- ⚠️ Cannot independently reconstruct the historical pre-edit 83-file/two-absent-root inventory from this diff. The implementer's report records matching before/after aggregate and key hashes; the controller should retain the underlying reservation inventory. The in-suite comparison additionally protects existing paths during successful and failed construction (`tests/integration/sync-selection.test.ts:57`, `:256`, `:351`, `:370`). This is an evidence boundary, not a discovered mutation.

### Strengths

- ✅ The helper gates return on actual proof/import readback and shared-lane initialization, while the integration test independently authors expected target objects rather than importing the helper's expected records (`tests/fixtures/sync-selection.ts:448`, `:500`; `tests/integration/sync-selection.test.ts:96`).
- ✅ Cleanup ownership is registered immediately after successful acquisitions, executed in reverse order with every action attempted, and shared by construction failure and idempotent normal close. Setup-only control/worker instances close before return (`tests/fixtures/sync-selection.ts:237`, `:254`, `:497`, `:522`). The failure test awaits real pool ends, worker closure and namespace drop, preserves the identical injected Error and includes fallback cleanup (`tests/integration/sync-selection.test.ts:370`, `:409`, `:414`, `:441`).
- ✅ Capture tests snapshot complete fixed table sets and compare capture/activity rows after replay as well as non-capture state after each call; the two target balances remain literal 300000 (`tests/integration/sync-selection.test.ts:62`, `:221`, `:311`).

### Issues

- Critical: None found.
- Important: None found.
- Minor: None found.

### Assessment

- **Task quality: Approved.** The two sizeable files remain cohesive: fixed fixture authoring/orchestration and its independent qualification. Private phase helpers and the unchanged lower-level APIs keep lifecycle and financial responsibilities understandable.
- **Focused dependency check — original/candidate independence:** inspected `tests/fixtures/evidence-v2-capture.ts:46` and `apps/control/src/demo-candidates.ts:101`; capture reads authored originals and candidate parsing uses the selected captured agreement, without supplying test expectations.
- **Focused dependency check — real bootstrap execution:** inspected `apps/control/src/activation-composition.ts:28` and `apps/control/src/review-proof-selection.ts:79`; normal reviewer preparation selects the protected launcher and executes the reserved bootstrap job, rather than accepting the sidecar alone.
- **Focused dependency check — complete payment envelope and client cleanup:** inspected `packages/sources/src/company-a.ts:49` and `packages/storage/src/transaction.ts:11`; `eventA` supplies exact version/identity/date fields and actual event hashes, and transaction clients release in `finally`.
- **Review evidence:** read the supplied diff once; recovered only the middle section omitted by tool-output truncation from that same package. No changed source file was separately read. No Git, database, source mutation, subagent or test rerun occurred. The implementer's supplied evidence reports Node 24/PostgreSQL 18, successful typecheck and all four focused integration tests passing with no skips or warnings; those are partial machine results, separate from this task review, whole-branch review and user acceptance.
