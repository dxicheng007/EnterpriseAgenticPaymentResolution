# Local Company A sync

For a cold first-apply lease (fresh DBs, full setup chain, inject/observe/replay), prefer the ordered [disposable staging](disposable-staging.md) checklist. This page remains the inject/sync detail once that lease is approve-ready.

Use a dedicated checkout and its own ignored `.local` directory, PostgreSQL 18 cluster and loopback ports. Use Node 24 and run `npm ci`. Set the ports in every setup and startup shell for this checkout. The following example uses the reserved local review namespace. Choose unused ports.

```sh
export EAPR_PG_PORT=55444 EAPR_DEMO_NAMESPACE=eapr_review_t2
export EAPR_CONTROL_PORT=3241 EAPR_WORKER_PORT=3242 EAPR_WEB_PORT=5182
```

Follow the [parent scope](parent-read-setup.md), [verification](verification-setup.md), [activation review](activation-review-setup.md) and [worker activation](worker-activation-setup.md) guides in this checkout. Use the `local-demo-v1` development fixture. Publish the exact registered scope and policy, set `EAPR_REVIEW_SELECTION_FILE`, and explicitly approve only Company A account `company-a.seller-a.cust-a-d22feb38e846-1`. Confirm the initial worker receipt and the 80000-cent cutover balance. For a first-apply rehearsal, start with a fresh isolated fixture that has never run this scenario.

In the supervisor shell, generate a private operator capability and start the local services. Keep model configuration unset for the demo.

```sh
export DEMO_OPERATOR_ENABLED=true
export DEMO_OPERATOR_TOKEN="$(node -p "require('node:crypto').randomBytes(32).toString('hex')")"
npm run dev
```

In a separate operator shell, load the same `DEMO_OPERATOR_TOKEN` privately into the environment and use the same control and worker port settings. Keep the token out of command arguments, URLs, logs, screenshots and browser configuration. The supervisor passes it only to the control and worker processes and generates separate service, admission and source-read capabilities.

```sh
npm run demo:inject -- freshPaymentA
```

The command inserts the fixed payment and allocation into the simulated source through control, then requests one synchronization from the worker. The worker captures the source feed and applies under the existing one-customer approval. The command prints the authoritative receipt ID, replay flag and before/after cents. A fresh apply reports 80000 and 50000. Read Parent at `2026-10-03T00:00:00.000Z` for the current 50000 cents and at cutover `2026-10-01T00:00:00.000Z` for 80000 cents.

If either result is uncertain, rerun the same command with the same configuration. The source IDs are fixed. A committed application returns the original receipt with `replayed: true`. A nonzero exit means the CLI could not confirm the result. The source insertion or worker commit may already be durable. Omit the enable flag on the next supervisor start to disable both operator commands.

Focused machine coverage exercises the actual control and worker roles with separate isolated databases. Its test-only global-fetch guard allows the configured control origin with redirect rejection and checks for forbidden attempts during the mounted interval. It covers the fixed worker HTTP path, pre-apply capture recovery and post-commit receipt replay. Full V5, full V6 and joint acceptance remain separate.
