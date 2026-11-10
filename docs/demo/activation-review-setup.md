# Local activation review setup

Use Node 24 and PostgreSQL 18 and start the loopback demo with `npm run dev`. Follow the [financial verification guide](verification-setup.md) to register the exact captures and complete attested financial verification. Follow the [activation policy guide](activation-policy-setup.md) to publish registered scopes, pin operator-reviewed bootstrap fixtures, and install the exact policy. Use the same local database and artifact registry throughout.

Set `EAPR_REVIEW_SELECTION_FILE` to the private policy selection JSON used for installation and restart the supervisor. The file contains exact subject, report and fixture references. Put it in a same-user directory with mode `0700`, use a regular mode-`0600` file without symlinks, and limit it to 1 MiB. Control loads the selection and installed policy once per process. Repeat the operator setup and restart to change them.

The supervisor generates a separate read-only source capability for control and the worker. The private semantic read route uses its own capability and a source allowlist derived from the demo catalog. Control independently observes current source semantics during preparation and again for new approval. The worker reads current semantics over the private route before starting its runtime transaction. It uses authenticated worker HTTP for the parent baseline. Missing policy or selection leaves the source, preview and parent surfaces available. A new preparation requires valid setup.

## Reviewer API

Use the local reviewer session and origin. Send the session cookie and CSRF header on mutations.

- Send `POST /api/review/:accountId/prepare` with an empty JSON object. Control validates the current capture, financial proof, target and source semantics. It executes or reuses a protected bootstrap verification for that exact target and saves the prepared package.
- Send `GET /api/review/:accountId` to read the latest saved package. This request reads the saved review without running verification.
- Send `GET /api/review/:accountId/packages/:packageHash/details` with the displayed package hash. Current account and source grants apply to every read, including historical packages. The response includes the saved parent baseline, proposed import and lineage, referenced citation IDs for the pinned snapshot, and the reviewed future scope. Both displayed balances use the plan's evaluation time. The read remains available after setup is removed if the saved bindings are intact. It performs zero parent writes.
- After explicitly reviewing the individual customer, send `POST /api/review/:accountId/activate`. Supply only `reviewPackageId`, `expectedPackageHash`, `expectedArtifactHash`, `expectedProfileHash`, `expectedTargetVersion` from the prepared package, and a fresh `idempotencyKey` for this action.

Control commits the approval intent, checks for an exact worker receipt, and publishes the original bundle if application is still pending. HTTP 200 contains the authoritative receipt and its replay flag. HTTP 202 indicates the durable intent remains pending. Retry the same body and key with a currently authorized reviewer session. See [first activation and receipt recovery](worker-activation-setup.md) for runtime inspection and recovery.
