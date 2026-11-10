# Task 1 authority ingress implementation

Base `41aa6c4443fb1b2e0b447303c4bc4deec59d02db`
Candidate `8eba70028d7b9c47ccc54cc6fe1bd8cf9b2e2544`
Branch `codex/platform-authority-ingress`

## Delivered

- Strict operation body and descriptor schemas, a separate 64-lowercase-hex ticket schema, and strict admission check/response/grants schemas. The descriptor tests use the existing canonical hash and cover the read-null preimage, individual field binding and parsed detachment.
- Control exports createAuthorityWorkerClient and AuthorityWorkerClient. Read binds the requested account. Command binds the parsed request account, action, key and beforeEpoch, in addition to existing result and state refinements.
- Worker exports createAuthorityAdmissionClient and AuthorityAdmissionClient. Every check posts the strict input to the fixed callback URL and validates the returned request hash.
- Both clients enforce exact configured loopback HTTP origins and bearer syntax, reject redirects, decode up to 256 KiB of response bytes with fatal UTF-8, and cancel on overflow or abort. Control combines the 8-second deadline with caller cancellation. Callback uses 2 seconds. Cancellation discards the reader without waiting for arbitrary underlying cleanup. Each client retains a local typed code allowlist and derives status and message through the unchanged AuthorityError factory.
- The contracts index and both protected inventories include the authority ingress leaf. Both mutation tests prove the affected build pins change. Existing construction leaf, recursive graph checks and missing-file cases are retained.

## Verification

Node v24.22.2 and Vitest v5.1.0.

- Behavioral red, exit 1, using npm run test:unit -- packages/contracts/test/authority-ingress.test.ts apps/control/test/authority-worker-client.test.ts apps/worker/test/authority-admission-client.test.ts. Three files executed with 12 failures and 6 passes. The minimal loadable clients resolved an otherwise-valid worker result for the wrong account and an otherwise-valid callback response with a different request hash. Oversized streams also resolved, and stalled reads did not invoke the cancel hooks. The DTO cases rejected the minimum implementation's permissive epoch and ticket checks.
- Focused green, exit 0, same command. Three files and 18 tests passed.
- Protected build green, exit 0, using npm run test:unit -- packages/evaluator/test/bootstrap-build.test.ts packages/evaluator/test/financial-attestation-build.test.ts. Two files and 7 tests passed.
- Full offline unit project, exit 0, using npm run test:unit. 84 files and 606 tests passed.
- npm run typecheck and git diff HEAD^ HEAD --check exited 0.

## Scope and self-review

Checked the exact eleven-path commit against the Task 1 file map and left root's separate documentation edit outside the commit. The code guards outbound DTOs before fetch, uses fixed paths and separate header placement, rejects substituted success envelopes and mismatched error statuses, and reconstructs safe errors without forwarding upstream details. The strengthened invalid UTF-8 fixture would still form a recognized error envelope with replacement decoding, so it specifically exercises fatal decoding. The existing authority implementation, activation, capture, apply, migrations and evaluator expectations have no edits in this commit.

The evidence is partial contract, transport and build-closure verification. No HTTP mounting, ticket minting, real session admission, SQL, provider calls or demo activity occurred. Independent exact-candidate review is pending and belongs to root.

## Round 1 review correction

Fix base `8eba70028d7b9c47ccc54cc6fe1bd8cf9b2e2544`
Fix candidate `c6220a03e0505c1a29eac14f4d972c3b3f67b1fe`

Root resolved the review finding by releasing one shared authority response helper. The exact fix moves the existing bound, typed allowlist, error reconstruction and response reader into apps/worker/src/authority-transport.ts. Its only consumers are the two authority clients. Self-review compared both exported client implementations byte for byte with the fix base and compared the helper body with both original copies after ignoring the two export markers. The scope check found exactly the three released paths.

- Node v24.22.2. npm run test:unit -- apps/control/test/authority-worker-client.test.ts apps/worker/test/authority-admission-client.test.ts exited 0 with 15 tests passing in 2 files.
- npm run typecheck exited 0. Staged and committed git diff --check both exited 0.

The correction used existing regression tests. No additional source, test, DB, provider or demo work occurred. Scoped independent re-review is pending.
