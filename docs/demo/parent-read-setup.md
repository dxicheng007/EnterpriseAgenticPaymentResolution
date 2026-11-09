# Local parent reads

Run `npm run dev` from the repository root. Control registers both source-derived demo candidates from their complete captured evidence. This step writes candidate artifacts to control storage. It runs before preview and works without protected verification pins.

Use the same database namespace and repository checkout for the development server and the publication command. The following operator command lists registered artifact, manifest, profile and scope references for review.

```sh
node --import tsx --input-type=module <<'JS'
import { createCandidateRegistry } from '@eapr/evaluator/registry';
import { createControlDb } from '@eapr/storage/control-db';
import { getDemoPair } from './scripts/native-db.ts';

const db = createControlDb({ connectionString: getDemoPair().control.appUrl });
try {
  const registry = createCandidateRegistry(db, '.local/artifacts');
  const { rows } = await db.query(
    'SELECT artifact_hash, manifest_id FROM artifact_captures ORDER BY manifest_id, artifact_hash',
  );
  for (const { artifact_hash, manifest_id } of rows) {
    const candidate = await registry.getCandidate(artifact_hash, manifest_id);
    for (const profile of candidate.profiles) {
      console.log(JSON.stringify({
        artifactHash: artifact_hash, manifestId: manifest_id,
        selectedProfileHash: profile.hash, scope: profile.scope,
      }));
    }
  }
} finally {
  await db.end();
}
JS
```

Choose the exact references for each customer scope you want to expose. Copy only the three selection fields below to a regular JSON file with mode `0600` in a same-user directory with mode `0700`.

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

See [scope publication](activation-policy-setup.md#publish-registered-scopes) for file requirements and recovery from writer contention. Scope publication uses candidate registration alone and requires no installed activation policy or eligible verification report. Verification setup remains separate. See the [verification setup guide](verification-setup.md).

After publication, select **Refresh candidates** in Preview. Each read captures the current registry, so the running services pick up publication without a restart. Preview uses the authenticated runtime worker to read the published customer scope. An inactive scope with no stored target returns version zero at its registered manifest time. Persisted records and their snapshot hashes are authoritative. A historical hash must identify an actual snapshot in the scope.

Source inspection and the candidate catalog stay available while the worker or registered scopes are unavailable. The catalog reports a safe parent-read diagnostic. For a permitted scope, the API returns 404 if its account or requested snapshot is absent from valid state and 503 if the registry or worker is unavailable. Preview uses its existing reference and dependency errors.

The reviewer session authorizes account and source access to `GET /api/parent/:accountId` and `GET /api/accounts/:accountId/activation`. Parent reads accept independent `asOf` and `snapshotHash` selectors. Use an explicit `asOf` to reproduce an approved cutover balance. The selectors preserve recorded time, version and snapshot hash, while `asOf` controls balance evaluation. Preview and both GETs perform zero runtime writes.
