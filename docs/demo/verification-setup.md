# Local demo verification setup

Run `npm run dev` from the repository root with Node 24 and PostgreSQL 18 on PATH. The supervisor loads the two synthetic source captures, checks their stored manifests and complete snapshots, and pins construction fixtures from the operator's private setup. Control receives the capture identities and a small whitelist of pin metadata. The worker and web process receive neither the pins nor the private setup location.

The catalog reports `verificationAvailable: true` once both captures have valid construction pins and the control registry and routes are ready. Preview a candidate before requesting verification. Preview registers the exact artifact, profiles, manifest, and snapshot. The reviewer session can then submit a verification job and read its summary. The availability flag does not grant approval. The evaluator reports eligibility separately, and missing mandatory coverage keeps the candidate ineligible.

Existing visible demo data is reused. A missing, malformed, or legacy protected fixture yields `VERIFICATION_FIXTURE_SETUP_REQUIRED`. A mismatch with the captured dataset or an immutable fixture conflict yields `VERIFICATION_FIXTURE_CONFLICT`. Health, evidence, and preview remain available when only protected setup fails. Corrupt visible input still prevents startup.

## Select regenerated construction fixtures

Use the same repository and local database configuration as the demo. The database must already be running with the original demo captured. Choose a new directory below the repository's ignored `.local` tree. Its parent must already exist and the path must be separate from the demo's active data and the evaluator store.

```sh
node --import tsx scripts/prepare-verification.ts --upgrade --new-root .local/verification-upgrade-1
```

The operator command regenerates the defined synthetic dataset in the new directory. It compares the regenerated visible manifests, members, original byte hashes, and source metadata against the existing visible data and captures. The command uses the original captured snapshots to pin the strict truth. It does not import source events or change the original visible or private files.

After both pins succeed, the command atomically publishes a private, mode-0600 selection with the exact capture bindings. It saves any previous selection bytes in a separate backup. The next supervisor startup validates the selection and reuses the immutable pins. Restart the demo through its existing supervisor lifecycle to pick up the selection.

If the data differs, the new directory remains available for local inspection and the previous selection stays in effect. The workflow supports exact regeneration of this synthetic dataset only. It cannot reconstruct arbitrary financial history. The generator currently fixes the fixture version. An identical existing bundle can be reused. A different bundle under the same key requires a new version from the fixture producer and evaluator owners. Selecting a different output directory does not change that key.

Keep selections, generated private files, and protected bundles out of commits, browser content, and evidence packets. Record only redacted setup codes, supported capture identities, and job summaries when collecting evidence.
