# Discovery capture reader candidate

| Field | Value |
| --- | --- |
| Task | b-discovery-capture-read, attempt 1 |
| Builder | /root/sol_discovery_capture |
| Branch | codex/discovery-capture-read |
| Base | `89622924c1c6ae1b34f56fd0908b8c8f30c0a328` |
| Candidate | `413d6e9783e255308cbc2e4001ae2c77a045d7f4` |
| Contract | Discovery shapes v3, F1/F2/F4/F8, and approved `b-discovery-capture-read.md` SHA-256 `c553fb1234516f079c92879411c777db9aacfe63ab6ac6a3a7541b0a9d3dedee` |
| Status | Awaiting independent Astra verification |
| Joint acceptance | Pending |

Inspect the exact candidate with `git diff 89622924c1c6ae1b34f56fd0908b8c8f30c0a328 413d6e9783e255308cbc2e4001ae2c77a045d7f4`.

- `packages/sources/src/discovery-reads.ts` owns the read-only entry point, aggregate/dossier/citation proof, safe error boundary and projection.
- `packages/sources/src/dossier.ts` shares the existing manifest/snapshot reads, pinned member inspection, hashing and citation construction. Discovery-specific strict member checks preserve the capture writer's existing path.
- `packages/sources/src/index.ts` publishes only the new API and result type.
- `tests/integration/discovery-capture-read.test.ts` exercises real migrated PostgreSQL and byte storage using normal public source setup. Privileged changes are confined to test setup.

## API and behavior

```ts
readDiscoveryCapture(
  dependencies: { db: Pool; store: Pick<EvidenceStore, 'get'> },
  catalog: ReadonlyMap<Id, SourceDefinition>,
  input: { companyId: Id; manifestId: Id },
): Promise<ValidatedDiscoveryCapture>
```

The result has the parsed DiscoveryBinding and detached, unique, lexically sorted raw seller/account tuples and complete aggregate citation IDs. Per root clarification, RawIdentitySchema permits a missing seller and validateSourceEvent accepts that identity when the account matches its resource payload. F8 preserves unresolved raw identities. The test keeps the sellerless event in the aggregate and retains its API citation while omitting it from the tuple list.

The reader selects the requested manifest and checks relational identities, registered streams and events, canonical hashes and complete membership. It verifies source bytes and lengths, compares extraction output against the original, validates scoped API original identity and payload, and compares stored citation data and relational associations to canonical recomputation. A complete dossier must match that proof. A missing or incomplete dossier is 409. A completed dossier whose aggregate is absent is 404. The reader repeats exact selected immutable SELECTs by fingerprint and rechecks the dossier after external reads. No database client or transaction remains checked out while waiting for the blob service. Safe SourceErrors preserve the boundary for the lifecycle adapter.

## Verification

Used Node 24 and PostgreSQL 18 on PATH. Exclusive lease `EAPR_PG_PORT=55438 EAPR_CONTROL_PORT=3601 EAPR_WORKER_PORT=3602 EAPR_WEB_PORT=5179 EAPR_TEST_PREFIX=eapr_test_review_t2 EAPR_TEST_NAMESPACE_PREFIX=eapr_test_review_t2 EAPR_DEMO_NAMESPACE=eapr_review_t2`.

| Command | Exit | Result |
| --- | --- | --- |
| `npm run test:integration -- tests/integration/discovery-capture-read.test.ts`, before API implementation | 1 | 8 behavioral failures after fixing two test-fixture construction errors. Valid captures returned no result and no corruption or barrier behavior existed. |
| Same command, before missing-seller correction | 1 | 9 passed and 2 failed because otherwise valid sellerless events were rejected. |
| `npm run typecheck` | 0 | Pass after final implementation and tests. |
| `npm run test:integration -- tests/integration/discovery-capture-read.test.ts tests/integration/v1-manifests.test.ts tests/integration/v1-evidence.test.ts` | 0 | 15 passed in 3 files, including 12 discovery tests. |
| `npm run test:unit` | 0 | 238 passed in 29 files on production-identical `88595f068f66f532766710e4151dd30eb89c8720`. |
| `npm run test:integration` | 0 | 97 passed in 17 files on production-identical `88595f068f66f532766710e4151dd30eb89c8720`. |
| `git diff 89622924c1c6ae1b34f56fd0908b8c8f30c0a328 HEAD --check` | 0 | Pass. |

Discovery cases compare digests of all public control/runtime table contents and column schemas around reads, including source rows, activity counters/events, migration ledgers and any installed public lifecycle rows. Tests assert exact output and safe error shape, both company captures, shared raw account IDs across sellers, older selection during publication, post-I/O dossier invalidation, missing and corrupt pinned rows, absent and changed original bytes, changed lengths, rehashed watermark and unregistered resource, equal-byte foreign citation associations, and malformed or unavailable services. The final test-only amendment moved the persisted-state baseline ahead of barrier release and added extraneous citation and changed stream membership corruptions. Exact-candidate typecheck and focused integration were rerun after the amendment. Candidate-specific partial logs are under `/tmp/eapr-capture-t2/` and only summary counts are reported here.

## Boundaries and limitations

Fixture-only source membership and database evidence. Independent exact-candidate review, live discovery, V4, lifecycle route adaptation, financial correctness, and joint acceptance require separate evidence. The base lacks the lifecycle migration, so the fixture asserts the installed table set and contents without lifecycle-specific rows. External reads use the existing source extractors and compare documents against stored extraction output. The recorded extractor version remains metadata. The post-I/O checks apply to the selected identities and dossier and do not provide atomic protection against privileged corruption after validation or physical blob loss after return. No candidate or authorization state is part of this API. No evidence packet or protected fixture artifact was generated for the focused discovery suite.
