# Local activation review setup

Use Node 24 and PostgreSQL 18 and start the loopback demo with `npm run dev`. Follow the [financial verification guide](verification-setup.md) to register the exact captures and complete attested financial verification. Follow the [activation policy guide](activation-policy-setup.md) to publish registered scopes, pin operator-reviewed bootstrap fixtures, and install the exact policy. Use the same local database and artifact registry throughout.

Set `EAPR_REVIEW_SELECTION_FILE` to the private policy selection JSON used for installation and restart the supervisor. The file contains exact subject, report and fixture references. Put it in a same-user directory with mode `0700`, use a regular mode-`0600` file without symlinks, and limit it to 1 MiB. Control loads the selection and installed policy once per process. Repeat the operator setup and restart to change them.

The supervisor generates a separate read-only source capability for control. The private semantic read route uses its own capability and a source allowlist derived from the demo catalog. Control independently observes current source semantics during preparation and again for new approval. It uses authenticated worker HTTP for the parent baseline. Missing policy or selection leaves the source, preview and parent surfaces available. A new preparation requires valid setup.

## Reviewer API

Use the local reviewer session and origin. Send the session cookie and CSRF header on mutations.

- Send `POST /api/review/:accountId/prepare` with an empty JSON object. Control validates the current capture, financial proof, target and source semantics. It executes or reuses a protected bootstrap verification for that exact target and saves the prepared package.
- Send `GET /api/review/:accountId` to read the saved package. This request reads the saved review without running verification.
- After explicitly reviewing the individual customer, send `POST /api/review/:accountId/activate`. Supply only `reviewPackageId`, `expectedPackageHash`, `expectedArtifactHash`, `expectedProfileHash`, `expectedTargetVersion` from the prepared package, and a fresh `idempotencyKey` for this action.

An HTTP 202 response with `state: "pending"` identifies the durable control intent. Control attempts to publish the canonical bundle after committing that intent. A retry with the same body and key recovers the same intent and retries publication, including after a control restart with a fresh authorized session. Review and publication leave runtime records unchanged. Runtime delivery, the authoritative worker receipt and the reviewer approval UI require later slices.
