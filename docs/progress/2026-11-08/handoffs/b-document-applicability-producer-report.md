# Document applicability producer — implementer report

**Lane.** New Developer 1 / Discovery, task D2 producer only.

**Candidate.** Branch `team-discovery`, tip `a98a990`, base `cdcb26d`.

| Commit | Subject |
| --- | --- |
| `dfbead4` | `refactor(sources): extract agreement directory identity grammar` |
| `5bfe28f` | `test(sources): add failing document applicability association cases` |
| `1053180` | `feat(sources): associate captured one-page agreements with source accounts` |
| `a98a990` | `feat(sources): expose prepareDocumentApplicability on discovery read tools` |

**Paths changed.** `packages/sources/src/{document-identity,document-applicability,source-coverage,discovery-tools,index}.ts`, `packages/sources/test/document-applicability.test.ts`, `tests/integration/discovery-document-applicability.test.ts`.

**Not changed.** `packages/discovery/**` consumers, apps/composition, `scripts/dev.ts`, db, contracts, public D1 tool wire, file `identities:[]`.

**Independent review.** PASS / PASS in `docs/progress/2026-11-08/reviews/b-document-applicability-producer-independent-review.md`.

**Limitations.** Producer integration omits explicit tamper/barrier/outage cases for the new entry point; shared `loadPinnedCapture` inherits those from existing capture-read suites. Association does not assert authenticity, fees, parent identity, or compiled eligibility.

**Requested next.** Root accepts `a98a990` and releases serialized C1/C2 consumer paths after confirming the accepted C2 citation matrix. Live provider work stays deferred.
