# Local activation policy setup

Run these commands from the repository root with Node 24, PostgreSQL 18, the migrated local control database, and the same database namespace used to register the candidates. The command connects to the control database and uses the repository's local evidence and candidate stores.

Put selection files in a same-user directory with mode `0700`, and give the files mode `0600`. Use regular files with no symlinks and at most 1 MiB of UTF-8 JSON. The schemas accept only the fields shown below. Replace the placeholders with exact IDs and hashes from the registered candidates, protected setup command and financial verification reports.

## Publish registered scopes

Create a selection file with one entry for each current subject you want to publish.

```json
{
  "entries": [
    {
      "artifactHash": "<registered artifact hash>",
      "manifestId": "<registered manifest ID>",
      "selectedProfileHash": "<registered profile hash>"
    }
  ]
}
```

```sh
node --import tsx scripts/prepare-activation-policy.ts --publish-scopes --selection-file .local/scope-selection.json
```

The command publishes safe profile and manifest members and a hash-addressed index under `.local/artifacts/activation-registry`, then replaces that directory's `current.json` atomically. It retains unrelated accounts and previous immutable versions. Each account's registered company and seller scope is fixed. The writer lock prevents concurrent updates from losing entries. If publication fails due to lock contention, retry after the active writer completes. For a stale lock, establish that its writer has stopped before removing `.local/artifacts/activation-registry/.writer-lock`.

Scope publication can precede financial verification and policy installation. It records identity metadata for later authenticated parent reads.

## Prepare and install the exact policy

For each selected subject, pin the operator-reviewed descriptor with `scripts/prepare-bootstrap-verification.ts` after completing [financial verification fixture setup](verification-setup.md). A `BOOTSTRAP_FIXTURE_SETUP_REQUIRED` diagnostic indicates that the selected descriptor or its evidence binding is missing or invalid. Use the exact bootstrap descriptor hash printed by the setup command. The descriptor separately binds the financial evidence bundle hash.

```sh
node --import tsx scripts/prepare-bootstrap-verification.ts \
  --artifact-hash 'registered-artifact-hash' --manifest-id 'registered-manifest-id' \
  --review-file .local/bootstrap-review.json
```

Obtain a completed, eligible financial attestation for the exact registered artifact, full profile set, capture and financial evidence pin under the fixed financial evaluator build. Prepare after the relevant evaluator and subject source closures stabilize. Changes to those closures require a fresh matching proof. Earlier unattested reports cannot be used for installation.

```json
{
  "policyId": "<operator policy ID>",
  "entries": [
    {
      "artifactHash": "<registered artifact hash>",
      "manifestId": "<registered manifest ID>",
      "selectedProfileHash": "<registered profile hash>",
      "financialReportId": "<registered attested report ID>",
      "bootstrapFixture": {
        "fixtureSetId": "<bootstrap fixture set ID>",
        "fixtureSetVersion": "<bootstrap fixture set version>",
        "fixtureHash": "<bootstrap descriptor hash>"
      }
    }
  ]
}
```

```sh
node --import tsx scripts/prepare-activation-policy.ts --selection-file .local/policy-selection.json
node --import tsx scripts/prepare-activation-policy.ts --selection-file .local/policy-selection.json --install
```

The first command validates the capture, protected descriptor, fixed builds and persisted financial provenance for each entry. It writes the canonical candidate to `.local/activation-policy/policies/<policyHash>.json` and prints its digest. The second command repeats the checks and explicitly installs the validated policy by atomically replacing `.local/activation-policy/current.json`. A failed validation leaves the current policy intact. Keep the policy directory under operator control and separate from the control-written artifact registry.

The policy is an operator input for later authority checks. Customer approval, target-bound bootstrap verification and activation require their own flows. When service composition loads installed policies, control and worker each capture the configured current file once at process startup. Rotation then requires explicit installation followed by service restarts. Local trust assumes the operator and these services run as the same OS user. Digests and issuer IDs verify bindings within this configured filesystem trust boundary.
