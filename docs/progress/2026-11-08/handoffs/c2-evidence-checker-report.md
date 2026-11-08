# C2 supported evidence checker

Candidate b03fced6023a31bd8e0b74e8dec7180286794d57 on 09104d49481d285e71d9162e674824045ae27427. The independently reviewed C1 private evidence storage and fixture producer are dependencies. C1 schema, storage, capture and byte validation are unchanged.

The private checker verifies each exact supplied profile's company/source/seller/account, producer identity and deterministic development account binding, the approved lookup and its applicable citations, exact supplied contract term tuples and active term completeness, and the frozen financial mapping templates with applicable USD citations. The evaluator reuses the observed output of its already-required captured baseline planner subprocess. It checks exact artifact/profile/input binding, pinned event membership, target version/asOf, complete independent records, and every operation's lineage field, source paths, mapping, evidence references and derivation IDs. The expected values come from producer/reference facts and frozen mapping rules. The subject transport carries no evidence, expected data or private paths.

Each supported profile has four assertion cases: identity, terms, mappings and observed captured lineage. The generated A and B subjects each had 13 passed, evidence_support cases4, zero unexplained difference and a report eligible under the existing report binding validator. Actual A totaled 53 cases and B 57. These retain the prior 41/45 planner executions and 8 capture validations, plus four independent evidence assertions. No second production planner execution is needed for evidence. Generated balances remain A 80,000 cents and B zero. V1 still returns evidence_support unavailable/cases0 and remains ineligible.

The real-capture test covers the actual producer's amendment terms and rejects extending the original term through the amendment. It rejects merging distinct same-name buyers and treating the unresolved B receipt as an approved account. Additional contradictions include incorrect account or lookup targets, missing/changed term and anchor, unrelated term or USD evidence, invented confirmed money constant, changed prior target, stale/missing lineage fields and duplicate rows. Rehashed lineage mutations change source event, source paths, operation index, mapping, citation or derivation while retaining the actual financial output. A genuinely compiled wrong B funding mapping retains its generated captured baseline pass but fails the supported evidence template assertion. A separately rehashed, fully validated v2 companion with a changed typed fee fails against the unchanged candidate despite successful transport and extraction. These deliberately altered candidate/lineage assertions are checker tests, not claims that the planner rejected submitted evidence.

Unsupported bootstrap profiles, nonempty findings, non-frozen reasoning and ensure_* output stay unavailable; a known invented money constant is a supported contradiction. Missing actual captured output is unavailable when there is no execution, while an attempted captured subprocess failure is a failed lineage assertion. The checker establishes neither parent identity outside the generated demo policy nor execution of parent configuration, activation, or persisted runtime. Product preparation/selection remains B-owned and was not changed or tested as a composed C2+B deployment here.

## Verification

Meaningful red at 09104d4: `npm run test:integration -- tests/integration/evidence-v2-store.test.ts` failed on the actual generated v2 launch because the new report assertion required 13 passing checks and the accepted C1 evaluator returned 12. The exact same positive path passed after C2. Test development also exposed and corrected a missing derivationInputs property on a deliberately confirmed finding fixture.

| Command | Exit | Result |
| --- | --- | --- |
| git diff HEAD^ HEAD --check | 0 | clean |
| npm run typecheck | 0 | exact commit passed |
| npm run test:unit -- packages/evaluator/test | 0 | exact commit 48 passed |
| npm run test:integration -- tests/integration/evidence-v2-store.test.ts | 0 | exact commit 1 passed |
| npm run test:unit | 0 | unchanged precommit tree 121 passed |
| npm run test:integration -- tests/integration/evidence-v2-store.test.ts tests/integration/v2-verification.test.ts | 0 | unchanged precommit tree 4 passed |

Lease PG 55435, control 3301, worker 3302, web 5176, prefix eapr_test_t2. Actual unique-seed A/B source captures were made in isolated PostgreSQL through the accepted test helper. The exact verification logs and changed file list are in the adjacent evidence directory. Fresh independent Astra review and joint acceptance remain pending.
