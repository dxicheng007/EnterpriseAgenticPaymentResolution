# AS source semantics implementation report

Candidate `a14625ee5e005e96a5b3c7ce0e7528a970a20236` on `codex/source-semantics`, based on `5ce860b4a74d8db13c96c27a2af8bd5164527625`. The worktree is clean. The candidate changes the seven paths reserved by the accepted handoff, SHA-256 `cf3ddf1a8cebdfd2247de6af6de06572f34470ab49b705a593792b74b09d3962`.

`@eapr/sources` exports `readCurrentSemantics`. `createSourceService` exposes the bound method. The producer reads the newest numeric epoch, validates its binding and pinned stream contracts, and observes the validated post-watermark semantic revisions under the existing source publication lock. Each observation returns the existing `SemanticPreflight` shape. The protected bootstrap and financial build manifests depend on the specific company and records modules. The changed source package index and bound service sit outside those protected closures.

`apps/control/src/source-semantics-composition.ts` exports `composeSourceSemantics`, with the private GET plugin and independent allowlisted control read port. The integration suite mounted the exported plugin through actual `buildControl({featurePlugins})` and exercised live loopback HTTP. Default startup mounting remains assigned to A4/A5.

## Partial verification

Node `v24.22.2` and PostgreSQL `18.6`. Native PostgreSQL port `55434`, HTTP control `3201`, worker `3202`, and reviewer web origin port `5175`. The suite starts control and worker services. Port 5175 is the configured origin and does not host a web server in these checks. `EAPR_TEST_PREFIX=eapr_test_review_t1`, `EAPR_TEST_NAMESPACE_PREFIX=eapr_test_review_t1`, `EAPR_DEMO_NAMESPACE=eapr_review_t1`. Tests provision and drop fresh isolated database pairs using the native harness. Released port 55434 with `npm run db:down` after verification.

| Command | Result |
| --- | --- |
| `npm run typecheck` | Exit 0 |
| `npm run test:unit -- packages/sources/test/current-semantics.test.ts packages/sources/test/change-feed.test.ts` | 7 passed across 2 files |
| `npm run test:unit` | 337 passed across 51 files |
| `npm run test:integration -- tests/integration/source-semantics.test.ts` | 10 passed, zero skipped |
| `git diff --cached --check` | Exit 0 before commit |

The focused unit cases cover scoped and governing folds, an unrelated seller/account, opaque revisions, invalid scope and prototype keys, unsafe epochs, and gaps. PostgreSQL tests cover epochs 2 and 10 with an incomplete latest dossier, an excluded event at the watermark, numeric events through sequence 10, financial-version isolation, corrupt manifest and event bindings, unsupported contracts, a missing watermark row, distinct same-account sellers, and conflicting and disjoint independent streams. Real publication and A/B scenario appends block in both transaction orders, as witnessed through PostgreSQL lock state. The suite checks accepted and denied HTTP calls, allowlist and credential isolation, body/query/path rejection, actual upload authorization, fresh direct and HTTP observations, source pool failure, and unchanged control and runtime rows before and after observations.

The missing-watermark regression initially returned 200 where 503 was required. The candidate binds the watermark's event ID without reading or folding its historical payload. The rerun passes.

## Shared Fastify router boundary

A separate diagnostic with actual `buildControl.inject` reproduced framework-level behavior outside the feature plugin. Fastify's global default parameter-length limit is 100, while `IdSchema` accepts up to 160. Source IDs of lengths 101–160 reach Fastify's 414 handler before the plugin. Invalid percent encoding reaches Fastify's 400 handler before the plugin and the default body echoes the raw URL path. These framework responses have neither the route's no-store header nor its strict `ApiError` shape. Route-level validation for decoded IDs and request inputs is covered in the green suite. Correcting the pre-route cases requires shared router ownership, raised to root because `apps/control/src/server.ts` is outside the current reservation.

Exact-candidate independent review and joint acceptance remain pending. The listed checks are partial verification.

## Shared router correction

Root assigned `apps/control/src/server.ts` to AS for the framework boundary. Corrected candidate `b3af86b00057e3236d478c6cb038c992be4e9236` supersedes the preceding transport diagnostic and includes `a14625e`. The correction also updates the private route and its integration test. The worktree is clean.

The shared Fastify parameter limit now matches the 160-character Id schema. The framework error callback sends a strict sanitized 400 `ApiError` with no-store when the mounted private GET is rejected before its route hook. Other bad URL responses retain the framework's existing status, code, and response shape, with a static message replacing the raw path echo. Default startup wiring remains deferred. The private capability still authenticates valid paths before source lookup.

Both added HTTP regressions failed on the preceding candidate and passed after correction. They publish and read real sources with 101- and 160-character references, verify denial without the bearer on those paths, and assert no-store and a strict sanitized 400 for malformed percent encoding and an overlong source reference. An unrelated malformed source dossier URL preserves the generic Fastify 400 shape without echoing the URL.

| Corrected-candidate command | Result |
| --- | --- |
| `npm run typecheck` | Exit 0 |
| `npm run test:unit -- packages/sources/test/current-semantics.test.ts packages/sources/test/change-feed.test.ts` | 7 passed across 2 files |
| `npm run test:unit` | 337 passed across 51 files |
| `npm run test:integration -- tests/integration/source-semantics.test.ts tests/integration/v0-foundation.test.ts tests/integration/v1-evidence.test.ts tests/integration/local-composition.test.ts` | 24 passed across 4 files, including 12 AS cases, zero skipped |
| `git diff --cached --check` | Exit 0 before commit |
| `npm run db:down` | Stopped the isolated native cluster, releasing port 55434 |

The correction used the same Node/PostgreSQL versions, environment prefixes and assigned ports. These results remain partial verification. Independent review is pending for the corrected SHA.
