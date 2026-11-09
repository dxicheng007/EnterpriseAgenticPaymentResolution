# Local demo verification setup

Run `npm run dev` from the repository root with Node 24 and PostgreSQL 18 on PATH. The supervisor loads the two synthetic source captures, checks their stored manifests and complete snapshots, and pins construction fixtures from the operator's private setup. Control receives the capture identities and a small whitelist of pin metadata. The worker and web process receive neither the pins nor the private setup location.

The catalog reports `verificationAvailable: true` once both captures have valid version-2 construction pins and the control registry and routes are ready. Preview a candidate before requesting verification. Preview registers the exact artifact, profiles, manifest, and snapshot. The reviewer session can then submit a verification job and read its summary. The availability flag does not grant approval. Each new local job validates the pinned visible capture, then the protected evaluator checks the evidence bundle and runs the thirteen mandatory checks. A completed job stores its report and financial attestation together. The evaluator reports eligibility separately, and missing mandatory coverage keeps the candidate ineligible.

Existing visible demo data is reused. An unreadable or invalid expected file or companion, or a companion present for only one company, yields `VERIFICATION_FIXTURE_SETUP_REQUIRED`. Decoded inputs that disagree with each other or with the capture, and immutable pin conflicts, yield `VERIFICATION_FIXTURE_CONFLICT`. Health, evidence, and preview remain available when only protected setup fails. Corrupt visible input still prevents startup.

The operator uses `expected-a.json` and `expected-b.json` from the selected private root. When both `evidence-a.json` and `evidence-b.json` are present, setup matches them to the expected files and assembles each complete snapshot's evidence from the captured database and original-byte store. Both bundles pass validation before publication starts. This reserves fixture version `2` for evidence bundles. A schema-less fixture cannot use version `2`.

Historical roots with both companions absent retain their original fixture pins. Select version-2 construction fixtures to enable new local jobs. Historical jobs and reports remain readable. A report from the legacy verifier requires a fresh verification run to establish the financial provenance needed for later activation.

## Select regenerated construction fixtures

Use the same repository and local database configuration as the demo. The database must already be running with the original demo captured. Choose a new directory below the repository's ignored `.local` tree. Its parent must already exist and the path must be separate from the demo's active data and the evaluator store.

```sh
node --import tsx scripts/prepare-verification.ts --upgrade --new-root .local/verification-upgrade-1
```

The operator command regenerates the defined synthetic dataset in the new directory. It compares the regenerated visible manifests, members, original byte hashes, and source metadata against the existing visible data and captures. The regenerated private root includes both companions. The command pins v2 using the existing captured snapshots, events, and evidence. Original visible files, historical pins, and reports are preserved.

After both v2 pins succeed, the command atomically publishes a private, mode-0600 selection with the exact capture bindings. It saves any previous selection bytes in a separate backup. The next supervisor startup validates the selection and reuses the immutable pins. Restart the demo through its existing supervisor lifecycle to pick up the selection.

If the data differs, the new directory remains available for local inspection and the previous selection stays in effect. The workflow supports exact regeneration of this synthetic dataset only. It cannot reconstruct arbitrary financial history. An identical existing bundle can be reused. The immutable key is the fixture ID and reserved version `2` in the evaluator store, shared across upgrade directories. A different bundle under that key requires a reviewed version from the fixture producer and evaluator owners. If publication stops after the first pin, the immutable pin remains unselected and the previous selection stays in effect.

Keep selections, generated private files, and protected bundles out of commits, browser content, and evidence packets. Record only redacted setup codes, supported capture identities, and job summaries when collecting evidence.
