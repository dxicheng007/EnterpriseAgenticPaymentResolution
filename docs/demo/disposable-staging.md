# Disposable staging — Company A fixture / AI-off

Step 2 checklist from the [demo MVP path](../progress/2026-11-10/demo-mvp-path.md): cold-operator setup for **live** control + worker APIs. This is not the opt-in staged UI (`?stub=1`). Never use the preserved original demo checkout or its PGDATA. Identities, cents, and pass/fail stay in the [demo contract](demo-contract.md); this page only sequences the existing setup guides.

## 0. Lease a disposable namespace

1. Dedicated checkout with its own ignored `.local` directory (no symlink to another developer's PGDATA).
2. Pick unused ports and a unique namespace, for example:

```sh
export PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@18/bin:$PATH
export EAPR_PG_PORT=55444 EAPR_DEMO_NAMESPACE=eapr_stage_company_a
export EAPR_CONTROL_PORT=3251 EAPR_WORKER_PORT=3252 EAPR_WEB_PORT=5184
```

3. `npm ci` in this checkout only.
4. Announce the lease (ports/namespace/checkout) before starting if others share the machine.

## 1. Fresh first-apply databases

`npm run db:down` only **stops** Postgres and **retains** approvals/imports. For a first-apply rehearsal:

1. Stop any services using this lease.
2. Drop/recreate **this lease’s** demo databases (or wipe the leased cluster data directory for this namespace only).
3. Do **not** reset the preserved original demo.

Then continue with setup below and `npm run dev`.

## 2. Operator setup chain (approve-ready)

Run each guide in this checkout with the same port/namespace exports:

| Order | Guide | Exit check |
| --- | --- | --- |
| 1 | [verification-setup](verification-setup.md) | Verification available for both pinned fixtures |
| 2 | [parent-read-setup](parent-read-setup.md) | Company A scope published; listing hashes filled |
| 3 | [activation-policy-setup](activation-policy-setup.md) | Exact operator policy installed |
| 4 | [activation-review-setup](activation-review-setup.md) | Review selection file ready |
| 5 | [worker-activation-setup](worker-activation-setup.md) | Worker can admit one-customer activation |
| 6 | [company-a-sync-setup](company-a-sync-setup.md) | Inject CLI path ready (token private) |

Restart supervisor with `EAPR_REVIEW_SELECTION_FILE` after selection publication as those guides require.

## 3. Boot and smoke (live APIs)

```sh
# Keep model configuration unset (AI-off).
export DEMO_OPERATOR_ENABLED=true
export DEMO_OPERATOR_TOKEN="$(node -p "require('node:crypto').randomBytes(32).toString('hex')")"
npm run dev
```

Open http://127.0.0.1:${EAPR_WEB_PORT:-5173} (or the Vite URL printed by `npm run dev`).

| Surface | Pass |
| --- | --- |
| Health | System ready; control/runtime migrations visible |
| Discovery | Discovery model is unavailable |
| Preview | `development-fixture`; parent writes `0`; owed **80000** at cutover |
| Review | Account `company-a.seller-a.cust-a-d22feb38e846-1` can **Prepare** / **Approve this customer only** |

Do **not** enable staged demo responses for this path. Staged mode is walkthrough theater only.

## 4. Money beats (after approve)

1. Parent at cutover `2026-10-01T00:00:00.000Z` → **80000**.
2. Separate operator shell (same ports + private `DEMO_OPERATOR_TOKEN`):

```sh
npm run demo:inject -- freshPaymentA
```

3. Parent current / `2026-10-03T00:00:00.000Z` → **50000**; cutover as-of still **80000**.
4. Operations → Refresh: sync receipt before **80000** / after **50000**; runtime model calls **Not measured** (AI-off posture).
5. Re-run the same inject: same receipt id, `replayed: true`, one economic effect.

## 5. Evidence and cleanup

- Keep sanitized screenshots/CLI receipts under an ignored `.evidence/…` tree; never commit operator tokens.
- Stop services; release the lease; leave the original demo untouched.

## Fail closed

| Symptom | Action |
| --- | --- |
| `FEATURE_NOT_IMPLEMENTED` | Fail the run; do not treat stubs as progress |
| Staged banner still on | Disable staged responses; use live APIs |
| Wrong account / Company B money | Stop; primary script is Company A only |
| Uncertain inject result | Rerun the same CLI; nonzero exit may still have committed |
| `VERIFICATION_FIXTURE_CONFLICT` / `verificationAvailable: false` after wipe | Ensure `.local/protected-evaluator` is mode `0700`, then `node --import tsx scripts/prepare-verification.ts --upgrade --new-root .local/verification-upgrade-<n>` and restart `npm run dev` |
| `PARENT_READ_UNAVAILABLE` for Company B only | Expected when only Company A scopes are published; primary script stays on A |

## Minimal live smoke (before approve)

With leased ports exported and `npm run dev` healthy:

1. Health → `status: ready`, migrations control **10** / runtime **7**
2. Discovery capabilities → `MODEL_UNAVAILABLE` / start unavailable
3. Preview `demo-candidate-a` → `parentWrites: 0`, `expectedBalanceCents: 80000`
4. After verification pins mount → `verificationAvailable: true` and an eligible verify job for Company A

Approve / inject / Operations still require the activation-policy + `EAPR_REVIEW_SELECTION_FILE` restart from the setup guides above.
