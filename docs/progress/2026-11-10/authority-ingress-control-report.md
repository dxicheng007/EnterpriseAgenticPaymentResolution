# Task 2 implementation report

- Released base: `0342050ba9b1b7dcaa7f0034136d1a70bf9acb43` on `codex/platform-authority-ingress`. Consumed accepted Task 1 transport/schema source `c6220a0`.
- Candidate: `d26dfde9fea7e4550cad43cb6f9f5b3edd28207c`.
- Scope: control composition, fixed reviewer routes, control unit tests and the explicitly delegated narrow `buildControl` framework contribution. Feature registration and capability configuration in the normal startup remain Task 4.

## Evidence

- Behavioral red, Node 24.22.2: `npm run test:unit -- apps/control/test/authority-ingress.test.ts` exited 1 with 12/12 cases failing against registered route shells and the original real server/session. In particular, anonymous malformed JSON returned parser 400 instead of session 401, and a malformed account URL returned framework 400 instead of session 401. The authorization/cancellation cases failed at worker dispatch before functionality existed, rather than a missing import.
- Green, same Node version and command: 1 file, 12/12 passed. Includes 4096-byte acceptance and 4097-byte rejection, actual loopback request-target bytes for bare queries/raw hash/absolute form, encoded fixed segments, and a genuine duplicate Authorization header. Includes repeat and cross-binding checks, fresh real session authorization, cancellation while authorization is pending by socket close/deadline/shutdown, ordinary POST completion, and 256-entry capacity reclamation through success, failure, disconnect and expiry. Shutdown proof observes abort and denial before drain on the closing listener, where opening a replacement request is unavailable.
- `npm run typecheck` and scoped staged `git diff --check` exited 0. Only focused unit/typecheck checks were run. Ephemeral HTTP listeners bound to 127.0.0.1 with port 0. No databases, provider calls, original demo changes, mounting, push or merge.

## Self-review

- The public hooks authenticate before input diagnostics. The server delegates only the two named framework errors for the exact method and registered authority route, leaves the undecodable account untouched, and retains unrelated fallbacks and the 160-character limit. The async callback catches auth failures directly because the framework invokes it outside the route error lifecycle.
- Kept the required request-only `run` seam. A composition-private WeakMap populated by the enclosing public scope associates the original Fastify request with its own raw response for disconnect handling. No ticket map inspection or mint interface is exported. Rechecked timer/listener cleanup, capacity, and that a pending mint cannot appear after the pre-close sweep.
- Each valid callback invokes the real authorizer with the original request and mode. Identity and current account membership gate detached grants, and identical-entry liveness plus the monotonic deadline are checked immediately before disclosure. The worker remains responsible for checking actual committed-source permission. Cancellation after successful final admission retains the accepted service boundary.
- No remaining Task 2 defect found in self-review. Fresh independent review, actual control→worker/A5 integration, and browser or joint acceptance remain pending.
