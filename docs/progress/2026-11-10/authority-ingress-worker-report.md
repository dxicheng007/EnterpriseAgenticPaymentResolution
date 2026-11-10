# Task 3 implementation report

Base `f5c162d19489516c1be6753d694a71c3f70fe7f6`. Candidate `a04677d92e0bb5040fabd8ea4d94e2119003fd4e`. Branch `codex/platform-authority-ingress`.

## Implementation

- Added the worker-only A5 identity lookup. It validates the account ID, selects the unique scalar scope and calls the existing canonical activation reader on one read-only repeatable-read client. It returns the decoded identity and approved source/pins and releases the client before further admission or service calls. It follows the accepted decode classifier, and discards the connection on rollback failure.
- Registered fixed private read/pause/resume/revoke routes with bearer-first authentication, 4 KiB mutation JSON, strict input and success DTOs, and safe no-store responses. The request-private map binds the exact live request to the ticket, complete descriptor hash and mode. The initial callback gates account before lookup and source before service dispatch. The existing service's authorizer performs a new callback on every invocation. The route independently compares the returned full committed identity, source and all three pins.
- Composed the accepted Task 1 `createAuthorityAdmissionClient({ baseUrl, token }).check({ ticket, requestHash, mode })` envelope and the existing source HTTP client. Missing admission fails closed after bearer authentication. With no source configured, only a service path that actually observes semantics receives the unavailable observer. Configured capabilities must be distinct. Task 2 supplies the original-session callback behind the Task 1 client.
- Added the explicitly released framework branch for only mounted authority route methods/actions. It decodes fixed segments as the installed router does, leaves the account opaque, authenticates before input diagnostics, and preserves existing unrelated framework paths. For the private HTTP shape, allowlisted ordinary Node transport headers plus the single admission header and bearer. Browser and arbitrary application header fields are rejected.

## Verification

- Node 24.22.2. Red `npm run test:unit -- apps/worker/test/authority-ingress.test.ts` returned exit 1 with 10 behavioral failures after correcting two test-harness mistakes. The registered-route implementation was pending, the pre-hook raw framework request returned 400 in place of bearer-first 401, and the pending identity stub failed the read-only lookup assertion. Recorded in `task-3-red.log`.
- First worker green reported 10 passed in 1 file. Final `npm run test:unit -- apps/worker/test/authority-ingress.test.ts apps/worker/test/authority-admission-client.test.ts apps/control/test/authority-worker-client.test.ts` returned exit 0 with 25 passed in 3 files. Recorded in `task-3-green.log`.
- Final `npm run typecheck` and staged `git diff --check` exited 0. Typecheck surfaced that Node types model a normalized authorization value as singular. The test now passes explicit raw header lines to node:http and asserts the duplicate lines reached Node's rawHeaders. It also asserts the exact unnormalized target bytes with ephemeral 127.0.0.1 listeners for bare query and raw fragment cases. No external network was used.

## Self-review and limits

- The accepted current-authority service/store/errors, existing parent/financial helpers, activation/capture/apply and migrations were outside the candidate. The worker production path imports no control module, evaluator or model runtime. The adapter sends no protected import contents and never reads command audit itself.
- Rechecked the actual service's initial, refresh, and replay admission paths against the worker port, and the separate initial account/source gates. The identity release happens before invoking the service. Scoped spies exercised context substitution, wrong mode and post-handler reuse, callback ordering, and valid-looking read and command substitutions across the entire identity and saved pins. Unit reader doubles verified transaction sequencing and selected error distinctions.
- No remaining Task 3 defect surfaced in self-review. This is focused unit and typecheck evidence. Genuine A5/SQL, the full control/session/callback HTTP chain, and mounting remain Task 4. No database, provider, original demo, push or merge operations were performed.
- Worker source ownership is released for exact-candidate independent review.
